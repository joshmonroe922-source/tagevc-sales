import { randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';

export async function startOperationalWorker(input: {
  service: 'marketing' | 'docusign' | 'intune' | 'snapshot' | 'shared_services';
  workerName: string;
  triggerSource: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
}) {
  const sb = await createPersistClient();
  const invocationId = randomUUID();
  const { data, error } = await sb.rpc('start_operational_worker_run', {
    p_invocation_id: invocationId,
    p_service: input.service,
    p_worker_name: input.workerName,
    p_entity_id: input.entityId ?? null,
    p_trigger_source: input.triggerSource,
    p_details: input.details ?? {},
  });
  return {
    invocationId,
    workerRunId: error ? null : (data as string | null),
    error: error?.message,
  };
}

export async function finishOperationalWorker(input: {
  workerRunId: string | null;
  status: 'completed' | 'partial' | 'failed';
  claimed?: number;
  succeeded?: number;
  failed?: number;
  leaseConflicts?: number;
  errorCode?: string | null;
  errorDetail?: string | null;
  details?: Record<string, unknown>;
}) {
  if (!input.workerRunId) return;
  const sb = await createPersistClient();
  await sb.rpc('finish_operational_worker_run', {
    p_worker_run_id: input.workerRunId,
    p_status: input.status,
    p_claimed: input.claimed ?? 0,
    p_succeeded: input.succeeded ?? 0,
    p_failed: input.failed ?? 0,
    p_lease_conflicts: input.leaseConflicts ?? 0,
    p_error_code: input.errorCode ?? null,
    p_error_detail: input.errorDetail ?? null,
    p_details: input.details ?? {},
  });
}

export async function acknowledgeSloAlert(input: {
  alertId: string;
  actorId: string;
  note?: string;
  expectedRowVersion: number;
}) {
  const sb = await createPersistClient();
  const { error } = await sb.rpc('acknowledge_slo_alert', {
    p_alert_id: input.alertId,
    p_actor_id: input.actorId,
    p_note: input.note ?? '',
    p_expected_row_version: input.expectedRowVersion,
  });
  if (error) throw new Error(error.message);
}

export async function reassignSloAlert(input: {
  alertId: string;
  actorId: string;
  ownerId: string;
  note?: string;
  expectedRowVersion: number;
}) {
  const sb = await createPersistClient();
  const { error } = await sb.rpc('reassign_slo_alert', {
    p_alert_id: input.alertId,
    p_actor_id: input.actorId,
    p_owner_id: input.ownerId,
    p_note: input.note ?? '',
    p_expected_row_version: input.expectedRowVersion,
  });
  if (error) throw new Error(error.message);
}

export async function evaluateSharedServiceSlos() {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('evaluate_shared_service_slos_phase38', {
    p_evaluated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  return data as {
    policy_version: string;
    evaluation_bucket: string;
    evaluations: number;
    transitions: Array<{
      alert_id: string;
      transition:
        | 'opened'
        | 'escalated'
        | 'deescalated'
        | 'same_bucket_reconciled'
        | 'resolved';
      service: string;
      metric_key: string;
      severity: string;
      entity_id: string | null;
    }>;
  };
}

export async function listOperationalHealth(input: {
  firmWide: boolean;
  entityId?: string | null;
}) {
  const sb = await createPersistClient();
  let evaluationQuery = sb
    .from('os_slo_evaluations')
    .select(
      'evaluation_id, service, metric_key, entity_id, severity, observed_value, warning_threshold, critical_threshold, detail, evaluated_at',
    )
    .order('evaluated_at', { ascending: false })
    .limit(100);
  let alertQuery = sb
    .from('os_slo_alerts')
    .select(
      'alert_id, service, metric_key, entity_id, status, severity, first_breached_at, last_breached_at, consecutive_breaches, occurrence_count, detail, owner_id, acknowledged_at, row_version, policy_version, current_policy_version, updated_at',
    )
    .eq('status', 'open')
    .order('updated_at', { ascending: false })
    .limit(50);
  let workerQuery = sb
    .from('os_operational_worker_runs')
    .select(
      'worker_run_id, service, worker_name, entity_id, trigger_source, status, claimed, succeeded, failed, lease_conflicts, error_code, started_at, completed_at',
    )
    .order('started_at', { ascending: false })
    .limit(50);
  let ownerQuery = sb
    .from('os_slo_owners')
    .select('ownership_id, service, metric_key, entity_id, owner_id, escalation_owner_id')
    .eq('active', true);
  if (!input.firmWide) {
    if (!input.entityId) {
      return {
        evaluations: [],
        alerts: [],
        workerRuns: [],
        owners: [],
        ownerProfiles: [],
        workerDefinitions: [],
        deliveryJobs: [],
      };
    }
    evaluationQuery = evaluationQuery.eq('entity_id', input.entityId);
    alertQuery = alertQuery.eq('entity_id', input.entityId);
    workerQuery = workerQuery.eq('entity_id', input.entityId);
    ownerQuery = ownerQuery.or(`entity_id.eq.${input.entityId},entity_id.is.null`);
  }
  const [
    { data: evaluations, error: evaluationError },
    { data: alerts, error: alertError },
    { data: workerRuns, error: workerError },
    { data: owners, error: ownerError },
    { data: workerDefinitions, error: definitionError },
    { data: deliveryJobs, error: deliveryError },
    { data: ownerProfiles, error: ownerProfileError },
  ] = await Promise.all([
    evaluationQuery,
    alertQuery,
    workerQuery,
    ownerQuery,
    sb.from('os_operational_worker_health').select('*'),
    firmWideDeliveryQuery(sb, input.firmWide),
    sb
      .from('profiles')
      .select('id,full_name,email,role,entity_id')
      .eq('active', true)
      .in('role', ['visionary', 'admin', 'service_lead', 'coo'])
      .order('full_name'),
  ]);
  const latestByMetric = new Map<string, NonNullable<typeof evaluations>[number]>();
  for (const evaluation of evaluations ?? []) {
    const key = `${evaluation.service}:${evaluation.metric_key}:${evaluation.entity_id ?? 'firm'}`;
    if (!latestByMetric.has(key)) latestByMetric.set(key, evaluation);
  }
  return {
    evaluations: [...latestByMetric.values()],
    alerts: alerts ?? [],
    workerRuns: workerRuns ?? [],
    owners: owners ?? [],
    ownerProfiles: (ownerProfiles ?? []).filter(
      (profile) =>
        input.firmWide ||
        profile.entity_id === input.entityId ||
        ['visionary', 'admin', 'service_lead'].includes(profile.role),
    ),
    workerDefinitions: workerDefinitions ?? [],
    deliveryJobs: deliveryJobs ?? [],
    error:
      evaluationError?.message ||
      alertError?.message ||
      workerError?.message ||
      ownerError?.message ||
      definitionError?.message ||
      deliveryError?.message ||
      ownerProfileError?.message,
  };
}

function firmWideDeliveryQuery(
  sb: Awaited<ReturnType<typeof createPersistClient>>,
  firmWide: boolean,
) {
  if (!firmWide) {
    return Promise.resolve({ data: [], error: null });
  }
  return sb
    .from('os_slo_delivery_jobs')
    .select('job_id, adapter, destination_key, status, attempt_count, next_attempt_at, last_error, updated_at')
    .in('status', ['queued', 'leased', 'retry_wait', 'failed'])
    .order('updated_at', { ascending: false })
    .limit(25);
}
