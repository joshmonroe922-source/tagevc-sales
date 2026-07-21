import { createPersistClient } from '@/lib/supabase/persist-client';

export type SloPolicyRow = {
  policy_id: string;
  policy_version: string;
  service: string;
  metric_key: string;
  scope: 'entity' | 'firm';
  comparator: 'higher_bad' | 'lower_bad';
  warning_threshold: number;
  critical_threshold: number;
  window_seconds: number;
  evaluation_interval_seconds: number;
  warning_breach_buckets: number;
  recovery_buckets: number;
  config: { webhook_destinations?: Record<string, string> };
  lifecycle_status: 'draft' | 'validated' | 'published' | 'retired';
  draft_of_policy_id: string | null;
  owner_id: string | null;
  owner_entity_id: string | null;
  row_version: number;
  created_by: string | null;
  validated_by: string | null;
  published_by: string | null;
};

export type SloOwnerOption = {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
  entity_id: string | null;
};

function errorMessage(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function listSloPolicyAdministration() {
  const sb = await createPersistClient();
  const [{ data: policies, error: policyError }, { data: owners, error: ownerError },
    { data: entities, error: entityError }, { data: tests, error: testError },
    { data: assignments, error: assignmentError }] =
    await Promise.all([
      sb
        .from('os_slo_policies')
        .select(
          'policy_id,policy_version,service,metric_key,scope,comparator,warning_threshold,critical_threshold,window_seconds,evaluation_interval_seconds,warning_breach_buckets,recovery_buckets,config,lifecycle_status,draft_of_policy_id,owner_id,owner_entity_id,row_version,created_by,validated_by,published_by',
        )
        .in('lifecycle_status', ['published', 'draft', 'validated'])
        .order('service')
        .order('metric_key'),
      sb
        .from('profiles')
        .select('id,full_name,email,role,entity_id')
        .eq('active', true)
        .in('role', ['visionary', 'admin', 'service_lead', 'coo'])
        .order('full_name'),
      sb.from('entities').select('entity_id,canonical_name').order('canonical_name'),
      sb
        .from('os_slo_route_tests')
        .select(
          'route_test_id,adapter,destination_key,owner_id,entity_id,status,last_result,requested_at',
        )
        .order('requested_at', { ascending: false })
        .limit(12),
      sb
        .from('os_slo_owners')
        .select('service,metric_key,entity_id,owner_id')
        .eq('active', true)
        .order('assigned_at', { ascending: false }),
    ]);
  errorMessage(policyError);
  errorMessage(ownerError);
  errorMessage(entityError);
  errorMessage(testError);
  errorMessage(assignmentError);
  const rows = ((policies ?? []) as SloPolicyRow[]).map((row) => {
    if (row.owner_id) return row;
    const assignment = assignments?.find(
      (item) =>
        item.service === row.service &&
        (item.metric_key === row.metric_key || item.metric_key === null) &&
        (row.scope === 'entity' || item.entity_id === null),
    );
    return assignment
      ? { ...row, owner_id: assignment.owner_id, owner_entity_id: assignment.entity_id }
      : row;
  });
  return {
    activePolicies: rows.filter((row) => row.lifecycle_status === 'published'),
    drafts: rows.filter((row) => row.lifecycle_status !== 'published'),
    owners: (owners ?? []) as SloOwnerOption[],
    entities: entities ?? [],
    routeTests: tests ?? [],
  };
}

export async function saveSloPolicyDraft(input: {
  sourcePolicyId: string;
  draftPolicyId?: string | null;
  policyVersion: string;
  comparator: 'higher_bad' | 'lower_bad';
  warningThreshold: number;
  criticalThreshold: number;
  windowSeconds: number;
  evaluationIntervalSeconds: number;
  warningBreachBuckets: number;
  recoveryBuckets: number;
  webhookDestinationKeys: string[];
  ownerId: string;
  ownerEntityId?: string | null;
  actorId: string;
  expectedRowVersion: number;
}) {
  const sb = await createPersistClient();
  const destinations = Object.fromEntries(
    input.webhookDestinationKeys.map((key) => [key, key]),
  );
  const { data, error } = await sb.rpc('save_slo_policy_draft_phase39', {
    p_source_policy_id: input.sourcePolicyId,
    p_draft_policy_id: input.draftPolicyId ?? null,
    p_policy_version: input.policyVersion,
    p_comparator: input.comparator,
    p_warning_threshold: input.warningThreshold,
    p_critical_threshold: input.criticalThreshold,
    p_window_seconds: input.windowSeconds,
    p_evaluation_interval_seconds: input.evaluationIntervalSeconds,
    p_warning_breach_buckets: input.warningBreachBuckets,
    p_recovery_buckets: input.recoveryBuckets,
    p_config: { webhook_destinations: destinations },
    p_owner_id: input.ownerId,
    p_owner_entity_id: input.ownerEntityId ?? null,
    p_actor_id: input.actorId,
    p_expected_row_version: input.expectedRowVersion,
  });
  errorMessage(error);
  return data;
}

export async function transitionSloPolicyDraft(input: {
  policyId: string;
  actorId: string;
  expectedRowVersion: number;
  transition: 'validate' | 'publish';
}) {
  const sb = await createPersistClient();
  const rpc =
    input.transition === 'validate'
      ? 'validate_slo_policy_draft_phase39'
      : 'publish_slo_policy_draft_phase39';
  const { data, error } = await sb.rpc(rpc, {
    p_policy_id: input.policyId,
    p_actor_id: input.actorId,
    p_expected_row_version: input.expectedRowVersion,
  });
  errorMessage(error);
  return data;
}

export async function requestSloRouteTest(input: {
  idempotencyKey: string;
  entityId?: string | null;
  adapter: 'in_app_owner' | 'webhook';
  destinationKey: string;
  ownerId?: string | null;
  actorId: string;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('request_slo_route_test_phase39', {
    p_idempotency_key: input.idempotencyKey,
    p_entity_id: input.entityId ?? null,
    p_adapter: input.adapter,
    p_destination_key: input.destinationKey,
    p_owner_id: input.ownerId ?? null,
    p_actor_id: input.actorId,
  });
  errorMessage(error);
  return data;
}
