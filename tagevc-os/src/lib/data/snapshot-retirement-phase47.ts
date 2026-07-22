import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  getSnapshotPhase46OpsDashboard,
  pageSnapshotOncallRoutesPhase46,
  runSnapshotPhase46OpsWorker,
} from '@/lib/data/snapshot-retirement-phase46';

export const PHASE47_SNAPSHOT_CONTRACT_VERSION = 'phase47-v1';

export function snapshotOncallAckSloMinutes(): number {
  const raw = Number(process.env.SNAPSHOT_ONCALL_ACK_SLO_MINUTES ?? 60);
  if (!Number.isFinite(raw)) return 60;
  return Math.min(10_080, Math.max(1, Math.trunc(raw)));
}

export async function completeSnapshotEd25519CutoverPhase47(input: {
  actorId: string;
  rotationId: string;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'complete_snapshot_ed25519_cutover_phase47',
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
        'Ed25519 cutover requires offline_script dual acceptance',
    };
  }
  return { ok: true as const, rotation: data as Record<string, unknown> };
}

export async function recordSnapshotOncallAckPhase47(input: {
  actorId: string;
  deliveryId: string;
  ackWithinMinutes?: number;
  detail?: Record<string, unknown>;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('record_snapshot_oncall_ack_phase47', {
    p_actor_id: input.actorId,
    p_delivery_id: input.deliveryId,
    p_ack_within_minutes:
      input.ackWithinMinutes ?? snapshotOncallAckSloMinutes(),
    p_detail: {
      contract_version: PHASE47_SNAPSHOT_CONTRACT_VERSION,
      ...(input.detail ?? {}),
    },
  });
  if (error || !data) {
    return {
      ok: false as const,
      error: error?.message ?? 'On-call acknowledgment recording failed',
    };
  }
  return { ok: true as const, ack: data as Record<string, unknown> };
}

export async function scanSnapshotOncallAckSloPhase47(input?: {
  actorId?: string;
  ackWithinMinutes?: number;
  lookbackHours?: number;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('scan_snapshot_oncall_ack_slo_phase47', {
    p_actor_id: input?.actorId ?? null,
    p_ack_within_minutes:
      input?.ackWithinMinutes ?? snapshotOncallAckSloMinutes(),
    p_lookback_hours: input?.lookbackHours ?? 168,
  });
  if (error || !data) {
    return {
      ok: false as const,
      error: error?.message ?? 'On-call ack SLO scan failed',
    };
  }
  return { ok: true as const, scan: data as Record<string, unknown> };
}

export async function runSnapshotPhase47OpsWorker(input?: {
  actorId?: string;
}) {
  const phase46 = await runSnapshotPhase46OpsWorker({
    actorId: input?.actorId,
  });
  const ackScan = await scanSnapshotOncallAckSloPhase47({
    actorId: input?.actorId,
  });
  return {
    ok: Boolean(phase46.ok && ackScan.ok),
    phase46,
    phase47: ackScan,
    qualification_eligible: false,
    attestation_eligible: false,
    production_relation_mutated: false,
  };
}

export async function pageSnapshotOncallRoutesPhase47(input?: {
  actorId?: string;
}) {
  const paging = await pageSnapshotOncallRoutesPhase46({
    actorId: input?.actorId,
  });
  const ackScan = await scanSnapshotOncallAckSloPhase47({
    actorId: input?.actorId,
  });
  return {
    ok: Boolean(paging.ok && ackScan.ok),
    paging,
    ackScan: ackScan.ok ? ackScan.scan : null,
    error: ackScan.ok ? undefined : ackScan.error,
    qualification_eligible: false,
    attestation_eligible: false,
    production_relation_mutated: false,
  };
}

export async function getSnapshotPhase47OpsDashboard() {
  const [phase46, ackSnapshots, ackAlerts, report] = await Promise.all([
    getSnapshotPhase46OpsDashboard(),
    (async () => {
      const sb = await createPersistClient();
      return sb
        .from('os_snapshot_oncall_ack_slo_snapshots')
        .select(
          'snapshot_id,delivery_id,window_key,ack_within_minutes,overdue,severity,acknowledged_at,created_at,qualification_eligible,attestation_eligible,production_relation_mutated',
        )
        .order('created_at', { ascending: false })
        .limit(12);
    })(),
    (async () => {
      const sb = await createPersistClient();
      return sb
        .from('os_snapshot_oncall_ack_alerts')
        .select(
          'alert_id,alert_kind,window_key,consecutive_ack_overdue,severity,created_at,qualification_eligible',
        )
        .order('created_at', { ascending: false })
        .limit(8);
    })(),
    (async () => {
      const sb = await createPersistClient();
      return sb.rpc('get_snapshot_phase47_ops_report');
    })(),
  ]);

  return {
    ...phase46,
    ok: true as const,
    oncallAckSnapshots: ackSnapshots.error ? [] : (ackSnapshots.data ?? []),
    oncallAckAlerts: ackAlerts.error ? [] : (ackAlerts.data ?? []),
    phase47Slo: report.error ? null : (report.data ?? null),
  };
}
