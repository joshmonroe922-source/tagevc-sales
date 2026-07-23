import { createPersistClient } from '@/lib/supabase/persist-client';
import { getSnapshotPhase50OpsDashboard } from '@/lib/data/snapshot-retirement-phase50';

export const PHASE51_SNAPSHOT_CONTRACT_VERSION = 'phase51-v1';

/** Escalate any Phase 50 protected_branch_cutover_blocked page receipt whose
 * delivery itself failed and has no later 'sent' receipt for the same
 * alert. Read + append-only — never retries delivery itself and never
 * mutates the Phase 49/50 rows. */
export async function escalateSnapshotPhase51PageDeliveryFailures(input?: {
  actorId?: string | null;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'escalate_snapshot_phase51_page_delivery_failures',
    { p_actor_id: input?.actorId ?? null },
  );
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, result: data as Record<string, unknown> };
}

/** Record evidence (service-role / firm-wide only) of whether the CI
 * path-guard is configured as a REQUIRED status check on the protected
 * branch. Never mutates GitHub branch-protection settings itself. */
export async function recordSnapshotPhase51RequiredCheckVerification(input: {
  actorId?: string | null;
  branchName: string;
  checkContext: string;
  required: boolean;
  detail?: Record<string, unknown>;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'record_snapshot_phase51_required_check_verification',
    {
      p_actor_id: input.actorId ?? null,
      p_branch_name: input.branchName,
      p_check_context: input.checkContext,
      p_required: input.required,
      p_detail: input.detail ?? {},
    },
  );
  if (error) return { ok: false as const, error: error.message };
  return {
    ok: true as const,
    verification: data as Record<string, unknown>,
  };
}

/** Continue Stage 4e soak observation: roll up the last few Phase 50 soak
 * status snapshots into a trend direction. Read + append-only — never
 * mutates enforcement or production evaluation. */
export async function recordSnapshotPhase51SoakTrend(input?: {
  actorId?: string | null;
  snapshots?: number;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('record_snapshot_phase51_soak_trend', {
    p_actor_id: input?.actorId ?? null,
    p_snapshots: input?.snapshots ?? 4,
  });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, trend: data as Record<string, unknown> };
}

export async function listSnapshotPhase51CriticalWindows(input?: {
  windowHours?: number;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'list_snapshot_phase51_critical_windows',
    { p_window_hours: input?.windowHours ?? 24 },
  );
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, windows: data as Record<string, unknown> };
}

export async function getSnapshotPhase51OpsReport() {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('get_snapshot_phase51_ops_report');
  if (error) {
    console.error('snapshot phase51 ops report unavailable', error.message);
    return null;
  }
  return data as Record<string, unknown> | null;
}

/** Read-only ops tick: escalates any failed page-delivery receipts and
 * continues the Stage 4e soak trend rollup. Never mutates any cutover;
 * qualification_eligible / attestation_eligible / production_relation_mutated
 * always stay false. */
export async function runSnapshotPhase51OpsTick(input?: {
  actorId?: string | null;
}) {
  const escalation = await escalateSnapshotPhase51PageDeliveryFailures({
    actorId: input?.actorId ?? null,
  });
  const soakTrend = await recordSnapshotPhase51SoakTrend({
    actorId: input?.actorId ?? null,
  });

  const report = await getSnapshotPhase51OpsReport();

  return {
    ok: escalation.ok && soakTrend.ok,
    error: !escalation.ok
      ? escalation.error
      : !soakTrend.ok
        ? soakTrend.error
        : undefined,
    escalated: escalation.ok
      ? Number(
          (escalation.result as { escalated?: number } | null)?.escalated ??
            0,
        )
      : 0,
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

export async function getSnapshotPhase51OpsDashboard() {
  const [phase50, pageFailureEscalations, requiredCheckVerifications, soakTrendSnapshots, opsAlerts, report] =
    await Promise.all([
      getSnapshotPhase50OpsDashboard(),
      (async () => {
        const sb = await createPersistClient();
        return sb
          .from('os_snapshot_phase51_page_failure_escalations')
          .select('escalation_id,alert_id,failed_receipt_id,created_at')
          .order('created_at', { ascending: false })
          .limit(12);
      })(),
      (async () => {
        const sb = await createPersistClient();
        return sb
          .from('os_snapshot_phase51_required_check_verifications')
          .select('verification_id,branch_name,check_context,required,created_at')
          .order('created_at', { ascending: false })
          .limit(12);
      })(),
      (async () => {
        const sb = await createPersistClient();
        return sb
          .from('os_snapshot_phase51_soak_trend_snapshots')
          .select(
            'trend_id,snapshots_compared,latest_blocked_rate,prior_blocked_rate,trend_direction,created_at',
          )
          .order('created_at', { ascending: false })
          .limit(14);
      })(),
      (async () => {
        const sb = await createPersistClient();
        return sb
          .from('os_snapshot_phase51_ops_alerts')
          .select('alert_id,alert_kind,reference_id,severity,created_at,qualification_eligible')
          .order('created_at', { ascending: false })
          .limit(12);
      })(),
      getSnapshotPhase51OpsReport(),
    ]);

  return {
    ...phase50,
    ok: true as const,
    phase51PageFailureEscalations: pageFailureEscalations.error
      ? []
      : (pageFailureEscalations.data ?? []),
    phase51RequiredCheckVerifications: requiredCheckVerifications.error
      ? []
      : (requiredCheckVerifications.data ?? []),
    phase51SoakTrendSnapshots: soakTrendSnapshots.error
      ? []
      : (soakTrendSnapshots.data ?? []),
    phase51OpsAlerts: opsAlerts.error ? [] : (opsAlerts.data ?? []),
    phase51Report: report,
  };
}
