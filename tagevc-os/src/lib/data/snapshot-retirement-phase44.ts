import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  getSnapshotPhase43VerifyColdDashboard,
  runProductionColdHeadCadencePhase43,
  snapshotColdRetentionCadenceHours,
  PHASE43_SNAPSHOT_CONTRACT_VERSION,
} from '@/lib/data/snapshot-retirement-phase43';

export const PHASE44_SNAPSHOT_CONTRACT_VERSION = 'phase44-v1';
export const PHASE44_DEFAULT_CANARY_CADENCE_HOURS = 6;

export {
  snapshotColdRetentionCadenceHours,
  PHASE43_SNAPSHOT_CONTRACT_VERSION,
  runProductionColdHeadCadencePhase43,
};

export function snapshotPhase44CanaryCadenceHours(): number {
  const raw = process.env.SNAPSHOT_PHASE44_CANARY_CADENCE_HOURS?.trim();
  if (!raw) return PHASE44_DEFAULT_CANARY_CADENCE_HOURS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 168) {
    throw new Error(
      'SNAPSHOT_PHASE44_CANARY_CADENCE_HOURS must be an integer between 1 and 168',
    );
  }
  return parsed;
}

export async function verifySnapshotExportPackageIntegrityPhase44(input: {
  actorId: string;
  packageId: string;
  detail?: Record<string, unknown>;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'verify_snapshot_export_package_integrity_phase44',
    {
      p_actor_id: input.actorId,
      p_package_id: input.packageId,
      p_detail: {
        contract_version: PHASE44_SNAPSHOT_CONTRACT_VERSION,
        ...(input.detail ?? {}),
      },
    },
  );
  if (error || !data) {
    return {
      ok: false as const,
      error: error?.message ?? 'Package integrity verification failed',
    };
  }
  return { ok: true as const, check: data as Record<string, unknown> };
}

export async function scheduleSnapshotPhase44CanaryOps(input: {
  actorId: string;
  cadenceHours?: number;
  definitionId?: string | null;
  packageId?: string | null;
  evidence?: Record<string, unknown>;
}) {
  const cadenceHours =
    input.cadenceHours ?? snapshotPhase44CanaryCadenceHours();
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('schedule_snapshot_phase44_canary_ops', {
    p_actor_id: input.actorId,
    p_cadence_hours: cadenceHours,
    p_definition_id: input.definitionId ?? null,
    p_package_id: input.packageId ?? null,
    p_evidence: {
      contract_version: PHASE44_SNAPSHOT_CONTRACT_VERSION,
      ...(input.evidence ?? {}),
    },
  });
  if (error || !data) {
    return {
      ok: false as const,
      error: error?.message ?? 'Phase 44 canary schedule RPC failed',
    };
  }
  return { ok: true as const, schedule: data as Record<string, unknown> };
}

export async function listDuePhase44CanarySchedules(limit = 25) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('list_due_phase44_canary_schedules', {
    p_limit: limit,
  });
  if (error) {
    return { ok: false as const, error: error.message };
  }
  return {
    ok: true as const,
    schedules: (data ?? []) as Array<{
      schedule_id: string;
      definition_id: string | null;
      package_id: string | null;
      cadence_hours: number;
      last_run_at: string | null;
      status: string;
      due: boolean;
    }>,
  };
}

export async function markSnapshotPhase44CanaryScheduleRun(input: {
  actorId?: string | null;
  scheduleId: string;
  runStatus?: 'active' | 'paused' | 'completed' | 'failed';
  evidence?: Record<string, unknown>;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'mark_snapshot_phase44_canary_schedule_run',
    {
      p_actor_id: input.actorId ?? null,
      p_schedule_id: input.scheduleId,
      p_run_status: input.runStatus ?? 'active',
      p_evidence: {
        contract_version: PHASE44_SNAPSHOT_CONTRACT_VERSION,
        ...(input.evidence ?? {}),
      },
    },
  );
  if (error || !data) {
    return {
      ok: false as const,
      error: error?.message ?? 'Canary schedule mark run failed',
    };
  }
  return { ok: true as const, schedule: data as Record<string, unknown> };
}

export async function scanSnapshotRetentionOpsAlertsPhase44(input?: {
  actorId?: string;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'scan_snapshot_retention_ops_alerts_phase44',
    { p_actor_id: input?.actorId ?? null },
  );
  if (error || !data) {
    return {
      ok: false as const,
      error: error?.message ?? 'Retention ops alert scan failed',
    };
  }
  return { ok: true as const, scan: data as Record<string, unknown> };
}

export async function listSnapshotRetentionOpsAlertsPhase44(limit = 50) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'list_snapshot_retention_ops_alerts_phase44',
    { p_limit: limit },
  );
  if (error) {
    return { ok: false as const, error: error.message };
  }
  return {
    ok: true as const,
    alerts: (data ?? []) as Array<Record<string, unknown>>,
  };
}

/**
 * Cron/worker tick: mark due Phase 44 canary schedules and scan retention alerts.
 * Does not flip qualification/attestation flags.
 */
export async function runSnapshotPhase44CanaryWorker(input?: {
  actorId?: string;
  limit?: number;
}) {
  const due = await listDuePhase44CanarySchedules(input?.limit ?? 25);
  if (!due.ok) return due;

  const results: Array<Record<string, unknown>> = [];
  for (const schedule of due.schedules) {
    const marked = await markSnapshotPhase44CanaryScheduleRun({
      actorId: input?.actorId ?? null,
      scheduleId: schedule.schedule_id,
      runStatus: 'active',
      evidence: {
        due: true,
        package_id: schedule.package_id,
        definition_id: schedule.definition_id,
        trigger: 'phase44_worker',
      },
    });
    results.push({
      schedule_id: schedule.schedule_id,
      ok: marked.ok,
      error: marked.ok ? null : marked.error,
    });
  }

  const alerts = await scanSnapshotRetentionOpsAlertsPhase44({
    actorId: input?.actorId,
  });

  return {
    ok: true as const,
    due_count: due.schedules.length,
    marked: results,
    alerts: alerts.ok ? alerts.scan : null,
    qualification_eligible: false,
    attestation_eligible: false,
  };
}

export async function getSnapshotPhase44OpsDashboard() {
  const [phase43, integrity, alerts, schedules, report] = await Promise.all([
    getSnapshotPhase43VerifyColdDashboard(),
    (async () => {
      const sb = await createPersistClient();
      return sb
        .from('os_snapshot_package_integrity_checks')
        .select(
          'check_id,package_id,check_status,key_id,created_at,qualification_eligible,attestation_eligible',
        )
        .order('created_at', { ascending: false })
        .limit(12);
    })(),
    listSnapshotRetentionOpsAlertsPhase44(12),
    (async () => {
      const sb = await createPersistClient();
      return sb
        .from('os_snapshot_phase44_canary_schedules')
        .select(
          'schedule_id,definition_id,package_id,cadence_hours,last_run_at,status,created_at,qualification_eligible',
        )
        .order('created_at', { ascending: false })
        .limit(12);
    })(),
    (async () => {
      const sb = await createPersistClient();
      return sb.rpc('get_snapshot_phase44_ops_report');
    })(),
  ]);

  return {
    ...phase43,
    ok: true as const,
    integrityChecks: integrity.error ? [] : (integrity.data ?? []),
    retentionAlerts: alerts.ok ? alerts.alerts : [],
    phase44CanarySchedules: schedules.error ? [] : (schedules.data ?? []),
    phase44Slo: report.error ? null : (report.data ?? null),
  };
}
