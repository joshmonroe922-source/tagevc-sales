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
      label: 'Confirm MDM / SSO / email access removed (manual)',
      status: 'pending',
      detail: 'HR / IT checklist — not auto-executed in Phase 23',
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
      } else {
        // access_note stays pending unless manually marked — leave as pending
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
    return { ok: true, run: mapRun(data as Record<string, unknown>) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'complete failed',
    };
  }
}
