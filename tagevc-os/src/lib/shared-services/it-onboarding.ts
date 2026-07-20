/**
 * IT onboarding automation (Phase 26) — mirror of offboarding.
 * Assign in-stock hardware + grant seats + MDM onboard webhook.
 */

import { randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  assignHardware,
  grantLicenseSeat,
  listHardwareAssets,
  listSoftwareLicenses,
} from '@/lib/shared-services/it-assets-repo';
import { getTicket, listTickets } from '@/lib/data/ticket-store';
import {
  createBroadcastNotification,
  logActivity,
} from '@/lib/data/activity';
import { invokeMdmLifecycleHook } from '@/lib/shared-services/it-mdm';

export type OnboardingChecklistItem = {
  id: string;
  kind: 'hardware_assign' | 'license_grant' | 'access_note';
  ref_id: string;
  label: string;
  status: 'pending' | 'done' | 'skipped' | 'failed';
  detail?: string;
};

export type OnboardingRun = {
  run_id: string;
  user_id: string;
  entity_id: string | null;
  status: 'open' | 'in_progress' | 'completed' | 'cancelled';
  checklist: OnboardingChecklistItem[];
  notes: string | null;
  ticket_id: string | null;
  source: 'manual' | 'hr_ticket' | 'status_change';
  created_at: string;
  completed_at: string | null;
};

function mapRun(row: Record<string, unknown>): OnboardingRun {
  const checklist = Array.isArray(row.checklist)
    ? (row.checklist as OnboardingChecklistItem[])
    : [];
  return {
    run_id: String(row.run_id),
    user_id: String(row.user_id),
    entity_id: (row.entity_id as string) ?? null,
    status: row.status as OnboardingRun['status'],
    checklist,
    notes: (row.notes as string) ?? null,
    ticket_id: (row.ticket_id as string) ?? null,
    source: (row.source as OnboardingRun['source']) || 'manual',
    created_at: String(row.created_at),
    completed_at: (row.completed_at as string) ?? null,
  };
}

export async function listOnboardingRuns(limit = 30): Promise<{
  rows: OnboardingRun[];
  error?: string;
}> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_it_onboarding_runs')
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

export async function startOnboarding(input: {
  user_id: string;
  entity_id?: string | null;
  actor_id?: string | null;
  notes?: string | null;
  auto_execute?: boolean;
  ticket_id?: string | null;
  source?: OnboardingRun['source'];
  /** Prefer specific in-stock hardware asset ids */
  hardware_asset_ids?: string[];
  /** Prefer specific license ids to grant */
  license_ids?: string[];
}): Promise<{ ok: true; run: OnboardingRun } | { ok: false; error: string }> {
  const userId = input.user_id.trim();
  if (!userId) return { ok: false, error: 'user_id required' };

  try {
    const [hw, lic] = await Promise.all([
      listHardwareAssets(200),
      listSoftwareLicenses(200),
    ]);

    const checklist: OnboardingChecklistItem[] = [];
    const preferHw = new Set(input.hardware_asset_ids ?? []);
    const preferLic = new Set(input.license_ids ?? []);

    const stock = hw.rows.filter((a) => a.status === 'in_stock');
    const hwCandidates =
      preferHw.size > 0
        ? stock.filter((a) => preferHw.has(a.asset_id))
        : stock
            .filter(
              (a) =>
                !input.entity_id ||
                !a.entity_id ||
                a.entity_id === input.entity_id,
            )
            .slice(0, 1);

    for (const a of hwCandidates) {
      checklist.push({
        id: `hw-${a.asset_id}`,
        kind: 'hardware_assign',
        ref_id: a.asset_id,
        label: `Assign ${a.kind}${a.model ? ` · ${a.model}` : ''} (${a.asset_id})`,
        status: 'pending',
      });
    }

    const licCandidates =
      preferLic.size > 0
        ? lic.rows.filter((l) => preferLic.has(l.license_id) && l.status === 'active')
        : lic.rows
            .filter((l) => {
              if (l.status !== 'active') return false;
              if (input.entity_id && l.entity_id && l.entity_id !== input.entity_id) {
                return false;
              }
              const used = l.seats_used ?? 0;
              return l.seat_count == null || used < l.seat_count;
            })
            .slice(0, 3);

    for (const l of licCandidates) {
      checklist.push({
        id: `lic-${l.license_id}`,
        kind: 'license_grant',
        ref_id: l.license_id,
        label: `Grant seat · ${l.product_name} (${l.license_id})`,
        status: 'pending',
      });
    }

    checklist.push({
      id: 'access-mdm',
      kind: 'access_note',
      ref_id: 'mdm',
      label:
        'MDM enroll / provision (Graph Intune and/or MDM_WEBHOOK_URL)',
      status: 'pending',
      detail: 'Phase 27: Graph device inventory + optional webhook onboard',
    });
    checklist.push({
      id: 'access-sso',
      kind: 'access_note',
      ref_id: 'sso',
      label: 'Confirm SSO / email / SaaS access granted (manual)',
      status: 'pending',
    });

    const run_id = `ONB-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4)}`;
    const now = new Date().toISOString();
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_it_onboarding_runs')
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
      const exec = await executeOnboarding(run.run_id, {
        actor_id: input.actor_id,
      });
      if (exec.ok) run = exec.run;
    }

    return { ok: true, run };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'start onboarding failed',
    };
  }
}

export async function executeOnboarding(
  runId: string,
  opts?: { actor_id?: string | null },
): Promise<{ ok: true; run: OnboardingRun } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const { data: existing, error: findErr } = await sb
      .from('os_it_onboarding_runs')
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

      if (item.kind === 'hardware_assign') {
        const res = await assignHardware({
          asset_id: item.ref_id,
          user_id: userId,
          actor_id: opts?.actor_id ?? null,
          note: `Onboarding ${runId}`,
        });
        item.status = res.ok ? 'done' : 'failed';
        item.detail = res.ok ? undefined : res.error;
      } else if (item.kind === 'license_grant') {
        const res = await grantLicenseSeat({
          license_id: item.ref_id,
          user_id: userId,
          actor_id: opts?.actor_id ?? null,
          note: `Onboarding ${runId}`,
        });
        item.status = res.ok ? 'done' : 'failed';
        item.detail = res.ok ? undefined : res.error;
      } else if (item.kind === 'access_note' && item.ref_id === 'mdm') {
        let email: string | null = null;
        try {
          const { data: profile } = await sb
            .from('profiles')
            .select('email')
            .eq('id', userId)
            .maybeSingle();
          email = (profile?.email as string) ?? null;
        } catch {
          /* optional */
        }
        const mdm = await invokeMdmLifecycleHook({
          action: 'onboard',
          user_id: userId,
          run_id: runId,
          entity_id: run.entity_id,
          email,
        });
        item.status = mdm.ok ? 'done' : mdm.skipped ? 'pending' : 'failed';
        item.detail = mdm.detail;
      } else {
        item.status = 'pending';
      }
    }

    const now = new Date().toISOString();
    const { data, error } = await sb
      .from('os_it_onboarding_runs')
      .update({
        checklist,
        status: 'in_progress',
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

export async function completeOnboarding(
  runId: string,
): Promise<{ ok: true; run: OnboardingRun } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const { data: existing, error: findErr } = await sb
      .from('os_it_onboarding_runs')
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
      .from('os_it_onboarding_runs')
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
      action: 'it_onboarding_completed',
      title: `Onboarding completed: ${completed.run_id}`,
      ref_type: 'ticket',
      ref_id: completed.ticket_id ?? completed.run_id,
      entity_id: completed.entity_id ?? undefined,
    });
    void createBroadcastNotification({
      kind: 'ticket_update',
      title: `IT onboarding ${completed.run_id} completed`,
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

export async function startOnboardingFromHrTicket(input: {
  ticket_id: string;
  actor_id?: string | null;
  auto_execute?: boolean;
}): Promise<{ ok: true; run: OnboardingRun } | { ok: false; error: string }> {
  const ticket = getTicket(input.ticket_id);
  if (!ticket) return { ok: false, error: 'Ticket not found' };
  if (ticket.service !== 'HR' && ticket.service !== 'IT') {
    return {
      ok: false,
      error: 'Ticket service must be HR or IT for onboarding',
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

  return startOnboarding({
    user_id: match[1],
    entity_id: ticket.entity_id,
    actor_id: input.actor_id,
    notes: `From ticket ${ticket.ticket_id}: ${ticket.title}`,
    ticket_id: ticket.ticket_id,
    source: 'hr_ticket',
    auto_execute: input.auto_execute,
  });
}

export function listOnboardingCandidateTickets(): Array<{
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
        blob.includes('onboard') ||
        blob.includes('new hire') ||
        blob.includes('provision') ||
        blob.includes('start date')
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

/**
 * Scan recently-updated active profiles and start onboarding (source=status_change)
 * when no prior onboarding run exists for that user.
 * Lookback defaults to 14 days; set IT_AUTO_ONBOARD=1 to auto-execute by default.
 */
export async function scanNewlyActiveProfilesForOnboarding(opts?: {
  limit?: number;
  lookback_days?: number;
  auto_execute?: boolean;
  actor_id?: string | null;
}): Promise<{
  scanned: number;
  started: number;
  skipped: number;
  results: Array<{ user_id: string; ok: boolean; detail: string }>;
}> {
  const limit = opts?.limit ?? 20;
  const lookbackDays = opts?.lookback_days ?? 14;
  const autoDefault =
    process.env.IT_AUTO_ONBOARD === '1' ||
    process.env.IT_AUTO_ONBOARD === 'true';
  const autoExecute = opts?.auto_execute ?? autoDefault;

  const since = new Date(
    Date.now() - lookbackDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const sb = await createPersistClient();
  const { data: profiles, error } = await sb
    .from('profiles')
    .select('id, email, active, entity_id, updated_at')
    .eq('active', true)
    .gte('updated_at', since)
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

  const { data: existingRuns } = await sb
    .from('os_it_onboarding_runs')
    .select('user_id, status');

  const known = new Set((existingRuns ?? []).map((r) => String(r.user_id)));
  const results: Array<{ user_id: string; ok: boolean; detail: string }> = [];
  let started = 0;
  let skipped = 0;

  for (const p of profiles ?? []) {
    const userId = String(p.id);
    if (known.has(userId)) {
      skipped += 1;
      results.push({
        user_id: userId,
        ok: true,
        detail: 'Onboarding run already exists',
      });
      continue;
    }
    const res = await startOnboarding({
      user_id: userId,
      entity_id: (p.entity_id as string) ?? null,
      actor_id: opts?.actor_id ?? null,
      notes: `Auto from active profile${p.email ? ` (${p.email})` : ''} · updated ${p.updated_at}`,
      source: 'status_change',
      auto_execute: autoExecute,
    });
    if (res.ok) {
      started += 1;
      known.add(userId);
      results.push({
        user_id: userId,
        ok: true,
        detail: `Started ${res.run.run_id}`,
      });
      void logActivity({
        module: 'shared_services',
        action: 'it_onboarding_status_change',
        title: `Onboarding from active profile: ${res.run.run_id}`,
        ref_type: 'ticket',
        ref_id: res.run.run_id,
        entity_id: res.run.entity_id ?? undefined,
      });
      void createBroadcastNotification({
        kind: 'ticket_update',
        title: `IT onboarding started (active profile)`,
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
