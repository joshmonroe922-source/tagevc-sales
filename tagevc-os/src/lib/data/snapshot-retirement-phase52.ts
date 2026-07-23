import { createPersistClient } from '@/lib/supabase/persist-client';
import { getSnapshotPhase51OpsDashboard } from '@/lib/data/snapshot-retirement-phase51';

export const PHASE52_SNAPSHOT_CONTRACT_VERSION = 'phase52-v1';

/** Record evidence from a scheduled/scripted read-only GitHub
 * branch-protection API check. Never mutates branch protection itself. */
export async function recordSnapshotPhase52BranchProtectionVerification(input: {
  actorId?: string | null;
  branchName: string;
  checkContext: string;
  required: boolean;
  contextsCount?: number | null;
  source?: 'scheduled' | 'manual' | 'script';
  detail?: Record<string, unknown>;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'record_snapshot_phase52_branch_protection_verification',
    {
      p_actor_id: input.actorId ?? null,
      p_branch_name: input.branchName,
      p_check_context: input.checkContext,
      p_required: input.required,
      p_contexts_count: input.contextsCount ?? null,
      p_source: input.source ?? 'scheduled',
      p_detail: input.detail ?? {},
    },
  );
  if (error) return { ok: false as const, error: error.message };
  return {
    ok: true as const,
    verification: data as Record<string, unknown>,
  };
}

/** Continue Stage 4e soak observation. Read + append-only — never mutates
 * enforcement or production evaluation. Flags always stay false. */
export async function recordSnapshotPhase52SoakTrend(input?: {
  actorId?: string | null;
  snapshots?: number;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('record_snapshot_phase52_soak_trend', {
    p_actor_id: input?.actorId ?? null,
    p_snapshots: input?.snapshots ?? 4,
  });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, trend: data as Record<string, unknown> };
}

export async function listSnapshotPhase52CriticalWindows(input?: {
  windowHours?: number;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'list_snapshot_phase52_critical_windows',
    { p_window_hours: input?.windowHours ?? 24 },
  );
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, windows: data as Record<string, unknown> };
}

export async function getSnapshotPhase52OpsReport() {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('get_snapshot_phase52_ops_report');
  if (error) {
    console.error('snapshot phase52 ops report unavailable', error.message);
    return null;
  }
  return data as Record<string, unknown> | null;
}

/** Read-only ops tick: continues Stage 4e soak trend. Branch-protection
 * verification is recorded by the optional scheduled script (or admin
 * action), not by this tick. Flags always stay false. */
export async function runSnapshotPhase52OpsTick(input?: {
  actorId?: string | null;
}) {
  const soakTrend = await recordSnapshotPhase52SoakTrend({
    actorId: input?.actorId ?? null,
  });

  const report = await getSnapshotPhase52OpsReport();

  return {
    ok: soakTrend.ok,
    error: !soakTrend.ok ? soakTrend.error : undefined,
    soakTrendDirection: soakTrend.ok
      ? String(
          (soakTrend.trend as { trend_direction?: string } | null)
            ?.trend_direction ?? 'unknown',
        )
      : 'unknown',
    report,
    qualification_eligible: false,
    attestation_eligible: false,
    production_relation_mutated: false,
  };
}

export async function getSnapshotPhase52OpsDashboard() {
  const [
    phase51,
    branchProtectionVerifications,
    soakTrendSnapshots,
    opsAlerts,
    report,
  ] = await Promise.all([
    getSnapshotPhase51OpsDashboard(),
    (async () => {
      const sb = await createPersistClient();
      return sb
        .from('os_snapshot_phase52_branch_protection_verifications')
        .select(
          'verification_id,branch_name,check_context,required,contexts_count,source,created_at',
        )
        .order('created_at', { ascending: false })
        .limit(12);
    })(),
    (async () => {
      const sb = await createPersistClient();
      return sb
        .from('os_snapshot_phase52_soak_trend_snapshots')
        .select(
          'trend_id,snapshots_compared,latest_blocked_rate,prior_blocked_rate,trend_direction,created_at',
        )
        .order('created_at', { ascending: false })
        .limit(14);
    })(),
    (async () => {
      const sb = await createPersistClient();
      return sb
        .from('os_snapshot_phase52_ops_alerts')
        .select(
          'alert_id,alert_kind,reference_id,severity,created_at,qualification_eligible',
        )
        .order('created_at', { ascending: false })
        .limit(12);
    })(),
    getSnapshotPhase52OpsReport(),
  ]);

  return {
    ...phase51,
    ok: true as const,
    phase52BranchProtectionVerifications: branchProtectionVerifications.error
      ? []
      : (branchProtectionVerifications.data ?? []),
    phase52SoakTrendSnapshots: soakTrendSnapshots.error
      ? []
      : (soakTrendSnapshots.data ?? []),
    phase52OpsAlerts: opsAlerts.error ? [] : (opsAlerts.data ?? []),
    phase52Report: report,
  };
}
