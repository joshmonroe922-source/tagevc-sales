/**
 * IT offboarding automation (Phase 23) — checklist + auto return/revoke.
 */

import { randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  listHardwareAssets,
  listSoftwareLicenses,
  returnHardware,
  revokeLicenseSeat,
} from '@/lib/shared-services/it-assets-repo';
import { getTicket, listTickets } from '@/lib/data/ticket-store';
import {
  createBroadcastNotification,
  logActivity,
} from '@/lib/data/activity';

export type OffboardingChecklistItem = {
  id: string;
  kind: 'hardware_return' | 'license_revoke' | 'access_note';
  ref_id: string;
  label: string;
  status: 'pending' | 'done' | 'skipped' | 'failed';
  detail?: string;
};

export type OffboardingRun = {
  run_id: string;
  user_id: string;
  entity_id: string | null;
  status: 'open' | 'in_progress' | 'completed' | 'cancelled';
  checklist: OffboardingChecklistItem[];
  notes: string | null;
  ticket_id: string | null;
  source: 'manual' | 'hr_ticket' | 'status_change';
  created_at: string;
  completed_at: string | null;
};

function mapRun(row: Record<string, unknown>): OffboardingRun {
  const checklist = Array.isArray(row.checklist)
    ? (row.checklist as OffboardingChecklistItem[])
    : [];
  return {
    run_id: String(row.run_id),
    user_id: String(row.user_id),
    entity_id: (row.entity_id as string) ?? null,
    status: row.status as OffboardingRun['status'],
    checklist,
    notes: (row.notes as string) ?? null,
    ticket_id: (row.ticket_id as string) ?? null,
    source: (row.source as OffboardingRun['source']) || 'manual',
    created_at: String(row.created_at),
    completed_at: (row.completed_at as string) ?? null,
  };
}

export async function listOffboardingRuns(limit = 30): Promise<{
  rows: OffboardingRun[];
  error?: string;
}> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_it_offboarding_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((r) => mapRun(r as Record<string, unknown>)),
    };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : 'list failed' };
  }
}

/**
 * Build checklist from assigned hardware + active license seats for a user.
 * License seats are firm-level counts — we add revoke tasks for each license
 * with seats_used > 0 when user_id matches assignment events (best-effort),
 * else one revoke suggestion per active license for the entity.
 */
export async function startOffboarding(input: {
  user_id: string;
  entity_id?: string | null;
  actor_id?: string | null;
  notes?: string | null;
  auto_execute?: boolean;
  ticket_id?: string | null;
  source?: OffboardingRun['source'];
}): Promise<{ ok: true; run: OffboardingRun } | { ok: false; error: string }> {
  const userId = input.user_id.trim();
  if (!userId) return { ok: false, error: 'user_id required' };

  try {
    const [hw, lic] = await Promise.all([
      listHardwareAssets(200),
      listSoftwareLicenses(200),
    ]);

    const checklist: OffboardingChecklistItem[] = [];

    for (const a of hw.rows) {
      if (a.assigned_user_id === userId && a.status === 'assigned') {
        checklist.push({
          id: `hw-${a.asset_id}`,
          kind: 'hardware_return',
          ref_id: a.asset_id,
          label: `Return ${a.kind}${a.model ? ` · ${a.model}` : ''} (${a.asset_id})`,
          status: 'pending',
        });
      }
    }

    // Best-effort: licenses with seats in use — revoke one seat per license
    // when entity matches (or all active licenses if no entity filter)
    for (const l of lic.rows) {
      if (l.status !== 'active') continue;
      if (input.entity_id && l.entity_id && l.entity_id !== input.entity_id) {
        continue;
      }
      if ((l.seats_used ?? 0) <= 0) continue;
      checklist.push({
        id: `lic-${l.license_id}`,
        kind: 'license_revoke',
        ref_id: l.license_id,
        label: `Revoke seat · ${l.product_name} (${l.license_id})`,
        status: 'pending',
      });
    }

    checklist.push({
      id: 'access-mdm',
      kind: 'access_note',
      ref_id: 'mdm',
      label: 'MDM / device retire (webhook if MDM_WEBHOOK_URL set)',
      status: 'pending',
      detail:
        'Phase 25: posts to MDM_WEBHOOK_URL when configured; otherwise manual',
    });
    checklist.push({
      id: 'access-sso',
      kind: 'access_note',
      ref_id: 'sso',
      label: 'Confirm SSO / email / SaaS access removed (manual)',
      status: 'pending',
      detail: 'Operator confirmation required',
    });

    const run_id = `OFF-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4)}`;
    const now = new Date().toISOString();
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_it_offboarding_runs')
      .insert({
        run_id,
        user_id: userId,
        entity_id: input.entity_id || null,
        status: 'open',
        checklist,
        notes: input.notes || null,
        actor_id: input.actor_id || null,
        ticket_id: input.ticket_id || null,
        source: input.source || 'manual',
        updated_at: now,
      })
      .select('*')
      .single();

    if (error) return { ok: false, error: error.message };

    let run = mapRun(data as Record<string, unknown>);

    if (input.auto_execute) {
      const exec = await executeOffboarding(run.run_id, {
        actor_id: input.actor_id,
      });
      if (exec.ok) run = exec.run;
    }

    return { ok: true, run };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'start offboarding failed',
    };
  }
}

export async function executeOffboarding(
  runId: string,
  opts?: { actor_id?: string | null },
): Promise<{ ok: true; run: OffboardingRun } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const { data: existing, error: findErr } = await sb
      .from('os_it_offboarding_runs')
      .select('*')
      .eq('run_id', runId)
      .maybeSingle();
    if (findErr) return { ok: false, error: findErr.message };
    if (!existing) return { ok: false, error: 'Run not found' };

    const run = mapRun(existing as Record<string, unknown>);
    const checklist = [...run.checklist];
    const userId = run.user_id;

    for (const item of checklist) {
      if (item.status === 'done' || item.status === 'skipped') continue;

      if (item.kind === 'hardware_return') {
        const res = await returnHardware({
          asset_id: item.ref_id,
          actor_id: opts?.actor_id ?? null,
          note: `Offboarding ${runId}`,
        });
        item.status = res.ok ? 'done' : 'failed';
        item.detail = res.ok ? undefined : res.error;
      } else if (item.kind === 'license_revoke') {
        const res = await revokeLicenseSeat({
          license_id: item.ref_id,
          user_id: userId,
          actor_id: opts?.actor_id ?? null,
          note: `Offboarding ${runId}`,
        });
        item.status = res.ok ? 'done' : 'failed';
        item.detail = res.ok ? undefined : res.error;
      } else if (item.kind === 'access_note' && item.ref_id === 'mdm') {
        const mdm = await invokeMdmOffboardHook({
          user_id: userId,
          run_id: runId,
          entity_id: run.entity_id,
        });
        item.status = mdm.ok ? 'done' : mdm.skipped ? 'pending' : 'failed';
        item.detail = mdm.detail;
      } else {
        item.status = 'pending';
      }
    }

    const autoDone = checklist.filter(
      (c) => c.kind !== 'access_note' && c.status === 'done',
    ).length;
    const autoTotal = checklist.filter((c) => c.kind !== 'access_note').length;
    const now = new Date().toISOString();
    const allAutoDone = autoTotal === 0 || autoDone === autoTotal;
    const status = allAutoDone ? 'in_progress' : 'in_progress';

    const { data, error } = await sb
      .from('os_it_offboarding_runs')
      .update({
        checklist,
        status,
        updated_at: now,
      })
      .eq('run_id', runId)
      .select('*')
      .single();

    if (error) return { ok: false, error: error.message };
    return { ok: true, run: mapRun(data as Record<string, unknown>) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'execute failed',
    };
  }
}

export async function completeOffboarding(
  runId: string,
): Promise<{ ok: true; run: OffboardingRun } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const { data: existing, error: findErr } = await sb
      .from('os_it_offboarding_runs')
      .select('*')
      .eq('run_id', runId)
      .maybeSingle();
    if (findErr) return { ok: false, error: findErr.message };
    if (!existing) return { ok: false, error: 'Run not found' };

    const run = mapRun(existing as Record<string, unknown>);
    const checklist = run.checklist.map((c) =>
      c.kind === 'access_note' && c.status === 'pending'
        ? { ...c, status: 'done' as const, detail: 'Marked complete by operator' }
        : c,
    );
    const now = new Date().toISOString();
    const { data, error } = await sb
      .from('os_it_offboarding_runs')
      .update({
        checklist,
        status: 'completed',
        completed_at: now,
        updated_at: now,
      })
      .eq('run_id', runId)
      .select('*')
      .single();
    if (error) return { ok: false, error: error.message };
    const completed = mapRun(data as Record<string, unknown>);
    void logActivity({
      module: 'shared_services',
      action: 'it_offboarding_completed',
      title: `Offboarding completed: ${completed.run_id}`,
      ref_type: 'ticket',
      ref_id: completed.ticket_id ?? completed.run_id,
      entity_id: completed.entity_id ?? undefined,
    });
    void createBroadcastNotification({
      kind: 'ticket_update',
      title: `IT offboarding ${completed.run_id} completed`,
      body: completed.ticket_id
        ? `Linked ticket ${completed.ticket_id}`
        : `User ${completed.user_id.slice(0, 8)}…`,
      href: '/shared-services/it/assets',
    });
    return { ok: true, run: completed };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'complete failed',
    };
  }
}

/**
 * Start offboarding from an HR Shared Services ticket.
 * Expects title/description to include `user:<uuid>` or `user_id=<uuid>`.
 */
export async function startOffboardingFromHrTicket(input: {
  ticket_id: string;
  actor_id?: string | null;
  auto_execute?: boolean;
}): Promise<{ ok: true; run: OffboardingRun } | { ok: false; error: string }> {
  const ticket = getTicket(input.ticket_id);
  if (!ticket) return { ok: false, error: 'Ticket not found' };
  if (ticket.service !== 'HR' && ticket.service !== 'IT') {
    return {
      ok: false,
      error: 'Ticket service must be HR or IT for offboarding',
    };
  }

  const blob = `${ticket.title}\n${ticket.description ?? ''}\n${ticket.desired_outcome ?? ''}`;
  const match =
    /user[_:\s-]*id[=:\s]*([0-9a-f-]{36})/i.exec(blob) ||
    /user[=:\s]+([0-9a-f-]{36})/i.exec(blob);
  if (!match) {
    return {
      ok: false,
      error:
        'Could not find user UUID in ticket — include `user:<uuid>` in description',
    };
  }

  return startOffboarding({
    user_id: match[1],
    entity_id: ticket.entity_id,
    actor_id: input.actor_id,
    notes: `From ticket ${ticket.ticket_id}: ${ticket.title}`,
    ticket_id: ticket.ticket_id,
    source: 'hr_ticket',
    auto_execute: input.auto_execute,
  });
}

/** Open HR/IT tickets that look like offboarding requests. */
export function listOffboardingCandidateTickets(): Array<{
  ticket_id: string;
  title: string;
  service: string;
  status: string;
}> {
  return listTickets()
    .filter((t) => {
      if (t.status === 'Closed' || t.status === 'Resolved') return false;
      if (t.service !== 'HR' && t.service !== 'IT') return false;
      const blob = `${t.title} ${t.description ?? ''}`.toLowerCase();
      return (
        blob.includes('offboard') ||
        blob.includes('termination') ||
        blob.includes('exit') ||
        blob.includes('revoke access')
      );
    })
    .slice(0, 20)
    .map((t) => ({
      ticket_id: t.ticket_id,
      title: t.title,
      service: t.service,
      status: t.status,
    }));
}

/** Optional MDM webhook — set MDM_WEBHOOK_URL for Phase 25 hooks. */
export async function invokeMdmOffboardHook(input: {
  user_id: string;
  run_id: string;
  entity_id?: string | null;
}): Promise<{ ok: boolean; skipped?: boolean; detail: string }> {
  const url = process.env.MDM_WEBHOOK_URL?.trim();
  if (!url) {
    return {
      ok: false,
      skipped: true,
      detail: 'MDM_WEBHOOK_URL not set — complete manually',
    };
  }
  try {
    const secret = process.env.MDM_WEBHOOK_SECRET?.trim();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({
        action: 'offboard',
        user_id: input.user_id,
        run_id: input.run_id,
        entity_id: input.entity_id ?? null,
        source: 'tagevc-os',
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        detail: `MDM HTTP ${res.status}: ${text.slice(0, 120)}`,
      };
    }
    return { ok: true, detail: 'MDM webhook accepted' };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : 'MDM webhook failed',
    };
  }
}

/**
 * Scan inactive profiles and start offboarding (source=status_change)
 * when no open/in_progress run exists.
 */
export async function scanInactiveProfilesForOffboarding(opts?: {
  limit?: number;
  auto_execute?: boolean;
  actor_id?: string | null;
}): Promise<{
  scanned: number;
  started: number;
  skipped: number;
  results: Array<{ user_id: string; ok: boolean; detail: string }>;
}> {
  const limit = opts?.limit ?? 20;
  const sb = await createPersistClient();
  const { data: profiles, error } = await sb
    .from('profiles')
    .select('id, email, active, entity_id')
    .eq('active', false)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) {
    return {
      scanned: 0,
      started: 0,
      skipped: 0,
      results: [{ user_id: '-', ok: false, detail: error.message }],
    };
  }

  const { data: openRuns } = await sb
    .from('os_it_offboarding_runs')
    .select('user_id, status')
    .in('status', ['open', 'in_progress']);

  const busy = new Set((openRuns ?? []).map((r) => String(r.user_id)));
  const results: Array<{ user_id: string; ok: boolean; detail: string }> = [];
  let started = 0;
  let skipped = 0;

  for (const p of profiles ?? []) {
    const userId = String(p.id);
    if (busy.has(userId)) {
      skipped += 1;
      results.push({
        user_id: userId,
        ok: true,
        detail: 'Open offboarding run already exists',
      });
      continue;
    }
    const res = await startOffboarding({
      user_id: userId,
      entity_id: (p.entity_id as string) ?? null,
      actor_id: opts?.actor_id ?? null,
      notes: `Auto from inactive profile${p.email ? ` (${p.email})` : ''}`,
      source: 'status_change',
      auto_execute: opts?.auto_execute ?? true,
    });
    if (res.ok) {
      started += 1;
      results.push({
        user_id: userId,
        ok: true,
        detail: `Started ${res.run.run_id}`,
      });
      void logActivity({
        module: 'shared_services',
        action: 'it_offboarding_status_change',
        title: `Offboarding from inactive profile: ${res.run.run_id}`,
        ref_type: 'ticket',
        ref_id: res.run.run_id,
        entity_id: res.run.entity_id ?? undefined,
      });
      void createBroadcastNotification({
        kind: 'ticket_update',
        title: `IT offboarding started (status change)`,
        body: res.run.run_id,
        href: '/shared-services/it/assets',
      });
    } else {
      results.push({ user_id: userId, ok: false, detail: res.error });
    }
  }

  return {
    scanned: (profiles ?? []).length,
    started,
    skipped,
    results,
  };
}

