import { createPersistClient } from '@/lib/supabase/persist-client';
import { getSnapshotPhase48OpsDashboard } from '@/lib/data/snapshot-retirement-phase48';

export const PHASE49_SNAPSHOT_CONTRACT_VERSION = 'phase49-v1';

/** Comma-separated protected branch names required in addition to the
 * database-seeded 'main'/'production' defaults. Visibility only — the
 * database policy table (grow-only) is the actual source of truth for
 * enforcement; this env only documents CI expectations. */
export function snapshotCiProtectedBranchesRequired(): string[] {
  const raw = (process.env.SNAPSHOT_CI_PROTECTED_BRANCH_REQUIRED ?? '').trim();
  if (!raw) return ['main', 'production'];
  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export async function completeSnapshotEd25519CutoverPhase49(input: {
  actorId: string;
  rotationId: string;
  branch: string;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'complete_snapshot_ed25519_cutover_phase49',
    {
      p_actor_id: input.actorId,
      p_rotation_id: input.rotationId,
      p_branch: input.branch,
    },
  );
  if (error || !data) {
    return {
      ok: false as const,
      error:
        error?.message ??
        'Ed25519 cutover requires CI offline_script dual acceptance for protected branches',
    };
  }
  return { ok: true as const, rotation: data as Record<string, unknown> };
}

export async function getSnapshotPhase49OpsReport() {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('get_snapshot_phase49_ops_report');
  if (error) {
    console.error('snapshot phase49 ops report unavailable', error.message);
    return null;
  }
  return data as Record<string, unknown> | null;
}

/** Read-only visibility tick — lists blocked protected-branch cutover
 * attempts within the window. Never pages, never mutates enforcement
 * state; enforcement itself only happens inside
 * complete_snapshot_ed25519_cutover_phase49. */
export async function listSnapshotPhase49CriticalWindows(input?: {
  windowHours?: number;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'list_snapshot_phase49_critical_windows',
    { p_window_hours: input?.windowHours ?? 24 },
  );
  if (error) {
    return { ok: false as const, error: error.message };
  }
  return { ok: true as const, windows: data as Record<string, unknown> };
}

export async function runSnapshotPhase49OpsWorker() {
  const windows = await listSnapshotPhase49CriticalWindows();
  const report = await getSnapshotPhase49OpsReport();
  return {
    ok: windows.ok,
    error: windows.ok ? undefined : windows.error,
    pendingBlockedCount: windows.ok
      ? ((windows.windows as { pending?: unknown[] } | null)?.pending ?? [])
          .length
      : 0,
    report,
    qualification_eligible: false,
    attestation_eligible: false,
    production_relation_mutated: false,
  };
}

export async function getSnapshotPhase49OpsDashboard() {
  const [phase48, protectedBranchPolicies, enforcementEvents, opsAlerts, report] =
    await Promise.all([
      getSnapshotPhase48OpsDashboard(),
      (async () => {
        const sb = await createPersistClient();
        return sb
          .from('os_snapshot_phase49_protected_branch_policies')
          .select('policy_id,branch_pattern,ci_required,created_at')
          .order('created_at', { ascending: false })
          .limit(20);
      })(),
      (async () => {
        const sb = await createPersistClient();
        return sb
          .from('os_snapshot_phase49_cutover_enforcement_events')
          .select(
            'event_id,rotation_id,branch,protected_branch,ci_required,ci_dual_acceptance_ready,decision,created_at,qualification_eligible',
          )
          .order('created_at', { ascending: false })
          .limit(12);
      })(),
      (async () => {
        const sb = await createPersistClient();
        return sb
          .from('os_snapshot_phase49_ops_alerts')
          .select('alert_id,alert_kind,rotation_id,severity,created_at,qualification_eligible')
          .order('created_at', { ascending: false })
          .limit(12);
      })(),
      getSnapshotPhase49OpsReport(),
    ]);

  return {
    ...phase48,
    ok: true as const,
    protectedBranchPolicies: protectedBranchPolicies.error
      ? []
      : (protectedBranchPolicies.data ?? []),
    cutoverEnforcementEvents: enforcementEvents.error ? [] : (enforcementEvents.data ?? []),
    phase49OpsAlerts: opsAlerts.error ? [] : (opsAlerts.data ?? []),
    phase49Slo: report,
    snapshotCiProtectedBranchesRequired: snapshotCiProtectedBranchesRequired(),
  };
}
