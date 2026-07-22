import { createHash } from 'node:crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  getSnapshotPhase47OpsDashboard,
  pageSnapshotOncallRoutesPhase47,
  runSnapshotPhase47OpsWorker,
  snapshotOncallAckSloMinutes,
} from '@/lib/data/snapshot-retirement-phase47';

export const PHASE48_SNAPSHOT_CONTRACT_VERSION = 'phase48-v1';

export function snapshotCiCutoverEnabled(): boolean {
  const raw = (process.env.SNAPSHOT_CI_CUTOVER_ENABLED ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function ciCutoverAcceptanceSha256(input: {
  rotationId: string;
  previousKeyId: string;
  nextKeyId: string;
  ciRunKey: string;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        ci_run_key: input.ciRunKey,
        contract_version: PHASE48_SNAPSHOT_CONTRACT_VERSION,
        next_key_id: input.nextKeyId,
        previous_key_id: input.previousKeyId,
        rotation_id: input.rotationId,
        verifier_kind: 'offline_script',
      }),
      'utf8',
    )
    .digest('hex');
}

export async function recordSnapshotCiCutoverAcceptancePhase48(input: {
  actorId: string;
  rotationId: string;
  previousKeyId: string;
  nextKeyId: string;
  ciRunKey: string;
  detail?: Record<string, unknown>;
}) {
  const acceptanceSha = ciCutoverAcceptanceSha256({
    rotationId: input.rotationId,
    previousKeyId: input.previousKeyId,
    nextKeyId: input.nextKeyId,
    ciRunKey: input.ciRunKey,
  });
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'record_snapshot_ci_cutover_acceptance_phase48',
    {
      p_actor_id: input.actorId,
      p_rotation_id: input.rotationId,
      p_acceptance_sha256: acceptanceSha,
      p_ci_run_key: input.ciRunKey,
      p_detail: {
        contract_version: PHASE48_SNAPSHOT_CONTRACT_VERSION,
        ci: true,
        ...(input.detail ?? {}),
      },
    },
  );
  if (error || !data) {
    return {
      ok: false as const,
      error: error?.message ?? 'CI cutover acceptance recording failed',
    };
  }
  return { ok: true as const, acceptance: data as Record<string, unknown> };
}

export async function completeSnapshotEd25519CutoverPhase48(input: {
  actorId: string;
  rotationId: string;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'complete_snapshot_ed25519_cutover_phase48',
    {
      p_actor_id: input.actorId,
      p_rotation_id: input.rotationId,
    },
  );
  if (error || !data) {
    return {
      ok: false as const,
      error:
        error?.message ??
        'Ed25519 cutover requires CI offline_script dual acceptance',
    };
  }
  return { ok: true as const, rotation: data as Record<string, unknown> };
}

export async function scanSnapshotOncallAckSloDashboardsPhase48(input?: {
  actorId?: string;
  days?: number;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'scan_snapshot_oncall_ack_slo_dashboards_phase48',
    {
      p_actor_id: input?.actorId ?? null,
      p_days: input?.days ?? 30,
    },
  );
  if (error || !data) {
    return {
      ok: false as const,
      error: error?.message ?? 'On-call ack SLO dashboard scan failed',
    };
  }
  return { ok: true as const, scan: data as Record<string, unknown> };
}

export async function runSnapshotPhase48OpsWorker(input?: {
  actorId?: string;
}) {
  const phase47 = await runSnapshotPhase47OpsWorker({
    actorId: input?.actorId,
  });
  const dashboards = await scanSnapshotOncallAckSloDashboardsPhase48({
    actorId: input?.actorId,
  });
  return {
    ok: Boolean(phase47.ok && dashboards.ok),
    phase47,
    phase48: dashboards,
    qualification_eligible: false,
    attestation_eligible: false,
    production_relation_mutated: false,
  };
}

export async function pageSnapshotOncallRoutesPhase48(input?: {
  actorId?: string;
}) {
  const paging = await pageSnapshotOncallRoutesPhase47({
    actorId: input?.actorId,
  });
  const dashboards = await scanSnapshotOncallAckSloDashboardsPhase48({
    actorId: input?.actorId,
  });
  return {
    ok: Boolean(paging.ok && dashboards.ok),
    paging,
    dashboards: dashboards.ok ? dashboards.scan : null,
    error: dashboards.ok ? undefined : dashboards.error,
    qualification_eligible: false,
    attestation_eligible: false,
    production_relation_mutated: false,
  };
}

export async function getSnapshotPhase48OpsDashboard() {
  const [phase47, ciAcceptances, ackDashboards, report] = await Promise.all([
    getSnapshotPhase47OpsDashboard(),
    (async () => {
      const sb = await createPersistClient();
      return sb
        .from('os_snapshot_ci_cutover_acceptances')
        .select(
          'ci_acceptance_id,rotation_id,acceptance_id,ci_run_key,acceptance_sha256,created_at,qualification_eligible,attestation_eligible,production_relation_mutated',
        )
        .order('created_at', { ascending: false })
        .limit(12);
    })(),
    (async () => {
      const sb = await createPersistClient();
      return sb
        .from('os_snapshot_oncall_ack_slo_dashboards')
        .select(
          'dashboard_id,destination_key,window_days,delivered_count,ack_count,overdue_count,pending_ack_count,ack_within_slo_rate,severity,created_at,qualification_eligible',
        )
        .order('created_at', { ascending: false })
        .limit(12);
    })(),
    (async () => {
      const sb = await createPersistClient();
      return sb.rpc('get_snapshot_phase48_ops_report');
    })(),
  ]);

  return {
    ...phase47,
    ok: true as const,
    ciCutoverAcceptances: ciAcceptances.error ? [] : (ciAcceptances.data ?? []),
    oncallAckDashboards: ackDashboards.error ? [] : (ackDashboards.data ?? []),
    phase48Slo: report.error ? null : (report.data ?? null),
    snapshotCiCutoverEnabled: snapshotCiCutoverEnabled(),
    snapshotOncallAckSloMinutes: snapshotOncallAckSloMinutes(),
  };
}
