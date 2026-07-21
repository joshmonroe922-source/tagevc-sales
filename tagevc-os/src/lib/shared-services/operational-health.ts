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

export async function evaluateSharedServiceSlos() {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('evaluate_shared_service_slos', {
    p_evaluated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  return data as {
    policy_version: string;
    evaluation_bucket: string;
    evaluations: number;
    transitions: Array<{
      alert_id: string;
      transition: 'opened' | 'escalated' | 'resolved';
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
      'alert_id, service, metric_key, entity_id, status, severity, first_breached_at, last_breached_at, consecutive_breaches, occurrence_count, detail, updated_at',
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
  if (!input.firmWide) {
    if (!input.entityId) return { evaluations: [], alerts: [], workerRuns: [] };
    evaluationQuery = evaluationQuery.eq('entity_id', input.entityId);
    alertQuery = alertQuery.eq('entity_id', input.entityId);
    workerQuery = workerQuery.eq('entity_id', input.entityId);
  }
  const [
    { data: evaluations, error: evaluationError },
    { data: alerts, error: alertError },
    { data: workerRuns, error: workerError },
  ] = await Promise.all([evaluationQuery, alertQuery, workerQuery]);
  const latestByMetric = new Map<string, NonNullable<typeof evaluations>[number]>();
  for (const evaluation of evaluations ?? []) {
    const key = `${evaluation.service}:${evaluation.metric_key}:${evaluation.entity_id ?? 'firm'}`;
    if (!latestByMetric.has(key)) latestByMetric.set(key, evaluation);
  }
  return {
    evaluations: [...latestByMetric.values()],
    alerts: alerts ?? [],
    workerRuns: workerRuns ?? [],
    error:
      evaluationError?.message || alertError?.message || workerError?.message,
  };
}
