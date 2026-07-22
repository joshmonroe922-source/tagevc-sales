import { createHash, createHmac } from 'node:crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';

export const PHASE41_SLO_CONTRACT_VERSION = 'phase41-v1';
export const PHASE41_SLO_COUNTERFACTUAL_LABEL =
  'COUNTERFACTUAL — no production state mutated';
export const PHASE42_SLO_DEFAULT_RETENTION_DAYS = 90;

export function sloSimulationExportRetentionDays(): number {
  const raw = process.env.SLO_SIMULATION_EXPORT_RETENTION_DAYS?.trim();
  if (!raw) return PHASE42_SLO_DEFAULT_RETENTION_DAYS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 30 || parsed > 730) {
    throw new Error(
      'SLO_SIMULATION_EXPORT_RETENTION_DAYS must be an integer between 30 and 730',
    );
  }
  return parsed;
}

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
  owner_effective_at: string | null;
  owner_expires_at: string | null;
  replacement_owner_id: string | null;
};

export type SloDraftComparison = {
  draft_policy_id: string;
  active_policy_id: string;
  changes: Array<{
    field: string;
    active: unknown;
    draft: unknown;
    material_risk: boolean;
  }>;
  material_risk: boolean;
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
  const [
    { data: policies, error: policyError },
    { data: owners, error: ownerError },
    { data: entities, error: entityError },
    { data: tests, error: testError },
    { data: assignments, error: assignmentError },
    { data: comparisons, error: comparisonError },
    { data: simulations, error: simulationError },
    { data: coverage, error: coverageError },
    { data: exports, error: exportError },
    { data: calendar, error: calendarError },
    { data: successionProposals, error: successionError },
    { data: successionDrills, error: drillError },
    { data: archivalReceipts, error: archivalError },
    { data: handoffSuggestions, error: handoffError },
    { data: simulationScenarios, error: scenarioError },
    { data: phase44Report, error: phase44ReportError },
    { data: nightlyReplayRuns, error: nightlyReplayError },
    { data: handoffDigests, error: handoffDigestError },
    { data: phase45Report, error: phase45ReportError },
    { data: firmWideReplayRuns, error: firmWideReplayError },
    { data: digestPublications, error: digestPublicationError },
    { data: ownershipChangeAlerts, error: ownershipChangeAlertError },
    { data: phase46Report, error: phase46ReportError },
  ] = await Promise.all([
    sb
      .from('os_slo_policies')
      .select(
        'policy_id,policy_version,service,metric_key,scope,comparator,warning_threshold,critical_threshold,window_seconds,evaluation_interval_seconds,warning_breach_buckets,recovery_buckets,config,lifecycle_status,draft_of_policy_id,owner_id,owner_entity_id,row_version,created_by,validated_by,published_by,owner_effective_at,owner_expires_at,replacement_owner_id',
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
    sb.from('os_slo_policy_draft_comparisons').select(
      'draft_policy_id,active_policy_id,changes,material_risk',
    ),
    sb.from('os_slo_simulations').select(
      'simulation_id,draft_policy_id,status,counterfactual,source_evaluation_count,requested_at,completed_at',
    ).order('requested_at', { ascending: false }).limit(12),
    sb.from('os_slo_owner_coverage_metrics').select(
      'policy_id,entity_id,owner_id,replacement_owner_id,expires_at,days_remaining,warning,eligible_replacement_named',
    ).order('expires_at').limit(50),
    sb.from('os_slo_simulation_exports').select(
      'export_id,simulation_id,counterfactual,label,metadata_digest,signature_key_id,result_count,retention_days,retained_until,exported_at',
    ).order('exported_at', { ascending: false }).limit(12),
    sb.rpc('get_slo_owner_coverage_calendar_phase41', { p_days_ahead: 30 }),
    sb
      .from('os_slo_owner_succession_proposals')
      .select(
        'proposal_id,policy_id,entity_id,current_owner_id,replacement_owner_id,expires_at,proposed_at',
      )
      .order('proposed_at', { ascending: false })
      .limit(12),
    sb
      .from('os_slo_owner_succession_drills')
      .select(
        'drill_id,policy_id,entity_id,candidate_replacement_id,eligibility_ok,expires_at,drilled_at,live_succession_mutated',
      )
      .order('drilled_at', { ascending: false })
      .limit(12),
    sb
      .from('os_slo_simulation_export_archival_receipts')
      .select(
        'receipt_id,export_id,metadata_digest,signature_key_id,retained_until,archived_at',
      )
      .order('archived_at', { ascending: false })
      .limit(12),
    sb
      .from('os_slo_owner_handoff_suggestions')
      .select(
        'suggestion_id,policy_id,current_owner_id,suggested_owner_id,eligibility_ok,reason,status,created_at',
      )
      .order('created_at', { ascending: false })
      .limit(12),
    sb
      .from('os_slo_simulation_scenarios')
      .select(
        'scenario_id,name,window_start,window_end,draft_policy_hash,published_policy_hash,created_at',
      )
      .order('created_at', { ascending: false })
      .limit(12),
    sb.rpc('get_slo_phase44_governance_report'),
    sb
      .from('os_slo_nightly_scenario_replay_runs')
      .select(
        'run_id,scheduled_for,scenarios_claimed,succeeded,failed,material_risk_count,status,evidence_sha256,completed_at,created_at',
      )
      .order('scheduled_for', { ascending: false })
      .limit(12),
    sb
      .from('os_slo_owner_handoff_digests')
      .select(
        'digest_id,digest_quarter,suggestion_count,expiry_count,accepted_count,digest_sha256,generated_at',
      )
      .order('generated_at', { ascending: false })
      .limit(8),
    sb.rpc('get_slo_phase45_governance_report'),
    sb
      .from('os_slo_firm_wide_nightly_replay_runs')
      .select(
        'run_id,schedule_id,scheduled_for,scenarios_claimed,succeeded,failed,material_risk_count,firm_wide_flag_count,status,evidence_sha256,completed_at,created_at',
      )
      .order('scheduled_for', { ascending: false })
      .limit(12),
    sb
      .from('os_slo_owner_handoff_digest_publications')
      .select(
        'publication_id,digest_id,digest_quarter,publish_status,published_at,recipient_count,destination_key,digest_sha256,created_at',
      )
      .order('created_at', { ascending: false })
      .limit(8),
    sb
      .from('os_slo_ownership_change_alerts')
      .select(
        'alert_id,alert_kind,window_key,ownership_id,expires_at,severity,metrics_sha256,created_at',
      )
      .order('created_at', { ascending: false })
      .limit(12),
    sb.rpc('get_slo_phase46_governance_report'),
  ]);
  errorMessage(policyError);
  errorMessage(ownerError);
  errorMessage(entityError);
  errorMessage(testError);
  errorMessage(assignmentError);
  // Phase 40/41/42/43 governance surfaces should not take down Shared Services if a
  // view/function grant is incomplete; degrade to empty panels instead.
  if (comparisonError) {
    console.error('slo draft comparisons unavailable', comparisonError.message);
  }
  if (simulationError) {
    console.error('slo simulations unavailable', simulationError.message);
  }
  if (coverageError) {
    console.error('slo owner coverage unavailable', coverageError.message);
  }
  if (exportError) {
    console.error('slo simulation exports unavailable', exportError.message);
  }
  if (calendarError) {
    console.error('slo coverage calendar unavailable', calendarError.message);
  }
  if (successionError) {
    console.error('slo succession proposals unavailable', successionError.message);
  }
  if (drillError) {
    console.error('slo succession drills unavailable', drillError.message);
  }
  if (archivalError) {
    console.error('slo export archival receipts unavailable', archivalError.message);
  }
  if (handoffError) {
    console.error('slo handoff suggestions unavailable', handoffError.message);
  }
  if (scenarioError) {
    console.error('slo simulation scenarios unavailable', scenarioError.message);
  }
  if (phase44ReportError) {
    console.error('slo phase44 governance report unavailable', phase44ReportError.message);
  }
  if (nightlyReplayError) {
    console.error('slo nightly replay runs unavailable', nightlyReplayError.message);
  }
  if (handoffDigestError) {
    console.error('slo handoff digests unavailable', handoffDigestError.message);
  }
  if (phase45ReportError) {
    console.error('slo phase45 governance report unavailable', phase45ReportError.message);
  }
  if (firmWideReplayError) {
    console.error('slo firm-wide nightly replay runs unavailable', firmWideReplayError.message);
  }
  if (digestPublicationError) {
    console.error('slo handoff digest publications unavailable', digestPublicationError.message);
  }
  if (ownershipChangeAlertError) {
    console.error('slo ownership-change alerts unavailable', ownershipChangeAlertError.message);
  }
  if (phase46ReportError) {
    console.error('slo phase46 governance report unavailable', phase46ReportError.message);
  }
  const archivedExportIds = new Set(
    (archivalError ? [] : (archivalReceipts ?? [])).map(
      (row: { export_id: string }) => row.export_id,
    ),
  );
  // Soft-hide archived exports even when the direct table select still returns them.
  let visibleExports = exportError ? [] : (exports ?? []);
  if (!exportError && visibleExports.length) {
    const exportIds = visibleExports.map(
      (row: { export_id: string }) => row.export_id,
    );
    const { data: archivedHits, error: archivedHitError } = await sb
      .from('os_slo_simulation_export_archival_receipts')
      .select('export_id')
      .in('export_id', exportIds);
    if (!archivedHitError && archivedHits) {
      for (const hit of archivedHits) {
        archivedExportIds.add(hit.export_id as string);
      }
    }
    visibleExports = visibleExports.filter(
      (row: { export_id: string }) => !archivedExportIds.has(row.export_id),
    );
  }
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
    comparisons: comparisonError
      ? []
      : ((comparisons ?? []) as SloDraftComparison[]),
    simulations: simulationError ? [] : (simulations ?? []),
    ownerCoverage: coverageError ? [] : (coverage ?? []),
    simulationExports: visibleExports,
    coverageCalendar: calendarError ? [] : (calendar ?? []),
    successionProposals: successionError ? [] : (successionProposals ?? []),
    successionDrills: drillError ? [] : (successionDrills ?? []),
    archivalReceipts: archivalError ? [] : (archivalReceipts ?? []),
    handoffSuggestions: handoffError ? [] : (handoffSuggestions ?? []),
    simulationScenarios: scenarioError ? [] : (simulationScenarios ?? []),
    phase44Report: phase44ReportError ? null : (phase44Report ?? null),
    nightlyReplayRuns: nightlyReplayError ? [] : (nightlyReplayRuns ?? []),
    handoffDigests: handoffDigestError ? [] : (handoffDigests ?? []),
    phase45Report: phase45ReportError ? null : (phase45Report ?? null),
    firmWideReplayRuns: firmWideReplayError ? [] : (firmWideReplayRuns ?? []),
    digestPublications: digestPublicationError ? [] : (digestPublications ?? []),
    ownershipChangeAlerts: ownershipChangeAlertError
      ? []
      : (ownershipChangeAlerts ?? []),
    phase46Report: phase46ReportError ? null : (phase46Report ?? null),
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  const primitive = JSON.stringify(value);
  if (primitive === undefined) {
    throw new Error('Canonical JSON contains a non-JSON value');
  }
  return primitive;
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sloExportSigningConfig(): { key: Buffer; keyId: string } {
  const keyId = process.env.SLO_SIMULATION_EXPORT_HMAC_KEY_ID?.trim() ?? '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(keyId)) {
    throw new Error('SLO_SIMULATION_EXPORT_HMAC_KEY_ID is not configured');
  }
  let encoded = '';
  const keyringRaw = process.env.SLO_SIMULATION_EXPORT_HMAC_KEYS?.trim();
  if (keyringRaw) {
    const keyring = JSON.parse(keyringRaw) as Record<string, unknown>;
    const candidate = keyring[keyId];
    encoded = typeof candidate === 'string' ? candidate.trim() : '';
  } else {
    encoded = process.env.SLO_SIMULATION_EXPORT_HMAC_KEY?.trim() ?? '';
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error(`SLO simulation export signing key is unavailable: ${keyId}`);
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length < 32) {
    throw new Error('SLO simulation export signing keys must decode to at least 32 bytes');
  }
  return { key, keyId };
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
  ownerEffectiveAt: string;
  ownerExpiresAt?: string | null;
  replacementOwnerId?: string | null;
  actorId: string;
  expectedRowVersion: number;
}) {
  const sb = await createPersistClient();
  const destinations = Object.fromEntries(
    input.webhookDestinationKeys.map((key) => [key, key]),
  );
  const { data, error } = await sb.rpc('save_slo_policy_draft_phase40', {
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
    p_owner_effective_at: input.ownerEffectiveAt,
    p_owner_expires_at: input.ownerExpiresAt ?? null,
    p_replacement_owner_id: input.replacementOwnerId ?? null,
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
  ownerEffectiveAt?: string;
  ownerExpiresAt?: string | null;
  replacementOwnerId?: string | null;
}) {
  const sb = await createPersistClient();
  const rpc = input.transition === 'validate'
    ? 'validate_slo_policy_draft_phase39'
    : 'publish_slo_policy_draft_phase40';
  const args = {
    p_policy_id: input.policyId,
    p_actor_id: input.actorId,
    p_expected_row_version: input.expectedRowVersion,
    ...(input.transition === 'publish' ? {
      p_owner_effective_at: input.ownerEffectiveAt ?? new Date().toISOString(),
      p_owner_expires_at: input.ownerExpiresAt ?? null,
      p_replacement_owner_id: input.replacementOwnerId ?? null,
    } : {}),
  };
  const { data, error } = await sb.rpc(rpc, args);
  errorMessage(error);
  return data;
}

export async function requestSloSimulation(input: {
  idempotencyKey: string;
  draftPolicyId: string;
  entityIds: string[];
  startsAt: string;
  endsAt: string;
  maxBuckets: number;
  actorId: string;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('request_slo_simulation_phase40', {
    p_idempotency_key: input.idempotencyKey,
    p_draft_policy_id: input.draftPolicyId,
    p_entity_ids: input.entityIds,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_max_buckets: input.maxBuckets,
    p_actor_id: input.actorId,
  });
  errorMessage(error);
  return data;
}

export async function processSloGovernancePhase40() {
  const sb = await createPersistClient();
  const { error: coverageError } = await sb.rpc('scan_slo_owner_expiry_phase40', {
    p_warning_days: 30,
  });
  errorMessage(coverageError);
  const { data: jobs, error: claimError } = await sb.rpc(
    'claim_slo_simulation_jobs_phase40',
    { p_limit: 5, p_lease_seconds: 300 },
  );
  errorMessage(claimError);
  let completed = 0;
  for (const job of (jobs ?? []) as Array<{ job_id: string; lease_token: string }>) {
    const { error } = await sb.rpc('run_slo_simulation_job_phase40', {
      p_job_id: job.job_id,
      p_lease_token: job.lease_token,
    });
    if (error) throw new Error(error.message);
    completed += 1;
  }
  return { claimed: jobs?.length ?? 0, completed };
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

export async function exportSloSimulation(input: {
  idempotencyKey: string;
  simulationId: string;
  actorId: string;
}) {
  const sb = await createPersistClient();
  const { data: simulation, error: simulationError } = await sb
    .from('os_slo_simulations')
    .select(
      'simulation_id,draft_policy_id,source_policy_id,status,counterfactual,starts_at,ends_at',
    )
    .eq('simulation_id', input.simulationId)
    .maybeSingle();
  errorMessage(simulationError);
  if (!simulation || simulation.status !== 'completed' || !simulation.counterfactual) {
    throw new Error('Only completed counterfactual simulations can be exported');
  }
  const { data: results, error: resultsError } = await sb
    .from('os_slo_simulation_results')
    .select(
      'source_evaluation_id,evaluation_bucket,historical_severity,counterfactual_severity',
    )
    .eq('simulation_id', input.simulationId)
    .order('evaluation_bucket')
    .order('source_evaluation_id');
  errorMessage(resultsError);
  const rows = results ?? [];
  const severitySummary = {
    healthy: rows.filter((row) => row.counterfactual_severity === 'healthy').length,
    warning: rows.filter((row) => row.counterfactual_severity === 'warning').length,
    critical: rows.filter((row) => row.counterfactual_severity === 'critical').length,
    unknown: rows.filter((row) => row.counterfactual_severity === 'unknown').length,
  };
  const resultDigest = sha256Text(
    rows
      .map((row) => {
        const ms = Date.parse(String(row.evaluation_bucket));
        if (Number.isNaN(ms)) {
          throw new Error('Simulation result bucket is not a valid timestamp');
        }
        return sha256Text(
          `${row.source_evaluation_id}|${ms}|${row.historical_severity}|${row.counterfactual_severity}`,
        );
      })
      .join(','),
  );
  const retentionDays = sloSimulationExportRetentionDays();
  const metadata = {
    contract_version: PHASE41_SLO_CONTRACT_VERSION,
    counterfactual: true,
    draft_policy_id: simulation.draft_policy_id,
    ends_at: simulation.ends_at,
    label: PHASE41_SLO_COUNTERFACTUAL_LABEL,
    result_count: rows.length,
    result_digest: resultDigest,
    retention_days: retentionDays,
    severity_summary: severitySummary,
    simulation_id: simulation.simulation_id,
    source_policy_id: simulation.source_policy_id,
    starts_at: simulation.starts_at,
  };
  const metadataCanonicalText = canonicalJson(metadata);
  const metadataDigest = sha256Text(metadataCanonicalText);
  const { key, keyId } = sloExportSigningConfig();
  const metadataSignature = createHmac('sha256', key)
    .update(metadataCanonicalText)
    .digest('hex');
  const { data, error } = await sb.rpc('export_slo_simulation_phase41', {
    p_idempotency_key: input.idempotencyKey,
    p_simulation_id: input.simulationId,
    p_metadata: metadata,
    p_metadata_canonical_text: metadataCanonicalText,
    p_metadata_digest: metadataDigest,
    p_signature_algorithm: 'hmac-sha256',
    p_signature_key_id: keyId,
    p_metadata_signature: metadataSignature,
    p_actor_id: input.actorId,
  });
  errorMessage(error);
  return data;
}

export async function listSloSimulationExportsPhase42(input: {
  actorId: string;
  includeExpired?: boolean;
  limit?: number;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('list_slo_simulation_exports_phase42', {
    p_actor_id: input.actorId,
    p_include_expired: input.includeExpired ?? false,
    p_limit: input.limit ?? 50,
  });
  errorMessage(error);
  return data ?? [];
}

export async function recordSloExportAuditAccess(input: {
  actorId: string;
  exportId: string;
  accessType: 'listed' | 'viewed' | 'downloaded' | 'replayed';
  detail?: Record<string, unknown>;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('record_slo_export_audit_access_phase42', {
    p_actor_id: input.actorId,
    p_export_id: input.exportId,
    p_access_type: input.accessType,
    p_detail: input.detail ?? {},
  });
  errorMessage(error);
  return data;
}

export async function proposeSloOwnerSuccession(input: {
  actorId: string;
  policyId: string;
  entityId?: string | null;
  replacementOwnerId: string;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('propose_slo_owner_succession_phase42', {
    p_actor_id: input.actorId,
    p_policy_id: input.policyId,
    p_entity_id: input.entityId ?? null,
    p_replacement_owner_id: input.replacementOwnerId,
  });
  errorMessage(error);
  return data;
}

export async function listSloSimulationExportsPhase43(input: {
  actorId: string;
  includeExpired?: boolean;
  includeArchived?: boolean;
  limit?: number;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('list_slo_simulation_exports_phase43', {
    p_actor_id: input.actorId,
    p_include_expired: input.includeExpired ?? false,
    p_include_archived: input.includeArchived ?? false,
    p_limit: input.limit ?? 50,
  });
  errorMessage(error);
  return data ?? [];
}

export async function archiveExpiredSloExportsPhase43(input: {
  actorId: string;
  limit?: number;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'archive_expired_slo_simulation_exports_phase43',
    {
      p_actor_id: input.actorId,
      p_limit: input.limit ?? 25,
    },
  );
  errorMessage(error);
  return data;
}

export async function archiveSloSimulationExportPhase43(input: {
  actorId: string;
  exportId: string;
  idempotencyKey: string;
  detail?: Record<string, unknown>;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('archive_slo_simulation_export_phase43', {
    p_actor_id: input.actorId,
    p_export_id: input.exportId,
    p_idempotency_key: input.idempotencyKey,
    p_detail: input.detail ?? {},
  });
  errorMessage(error);
  return data;
}

/** Drill only — does not call propose_slo_owner_succession_phase42. */
export async function runSloOwnerSuccessionDrillPhase43(input: {
  actorId: string;
  policyId: string;
  entityId?: string | null;
  candidateReplacementId: string;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('run_slo_owner_succession_drill_phase43', {
    p_actor_id: input.actorId,
    p_policy_id: input.policyId,
    p_entity_id: input.entityId ?? null,
    p_candidate_replacement_id: input.candidateReplacementId,
  });
  errorMessage(error);
  return data;
}

export const PHASE44_SLO_CONTRACT_VERSION = 'phase44-v1';

export async function registerSloSimulationScenarioPhase44(input: {
  actorId: string;
  name: string;
  windowStart: string;
  windowEnd: string;
  entityScope?: unknown;
  draftPolicyHash: string;
  publishedPolicyHash?: string | null;
  lastResultDigest?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('register_slo_simulation_scenario_phase44', {
    p_actor_id: input.actorId,
    p_name: input.name,
    p_window_start: input.windowStart,
    p_window_end: input.windowEnd,
    p_entity_scope: input.entityScope ?? [],
    p_draft_policy_hash: input.draftPolicyHash,
    p_published_policy_hash: input.publishedPolicyHash ?? null,
    p_last_result_digest: input.lastResultDigest ?? null,
    p_metadata: input.metadata ?? {},
  });
  errorMessage(error);
  return data;
}

export async function replaySloSimulationScenarioPhase44(input: {
  actorId: string;
  scenarioId: string;
  idempotencyKey: string;
  draftPolicyId?: string | null;
  maxBuckets?: number;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('replay_slo_simulation_scenario_phase44', {
    p_actor_id: input.actorId,
    p_scenario_id: input.scenarioId,
    p_idempotency_key: input.idempotencyKey,
    p_draft_policy_id: input.draftPolicyId ?? null,
    p_max_buckets: input.maxBuckets ?? 168,
  });
  errorMessage(error);
  return data;
}

/** Suggest only — does not apply live succession. */
export async function suggestSloOwnerHandoffsPhase44(input?: {
  warningDays?: number;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('suggest_slo_owner_handoffs_phase44', {
    p_warning_days: input?.warningDays ?? 30,
  });
  errorMessage(error);
  return data;
}

export async function resolveSloOwnerHandoffSuggestionPhase44(input: {
  actorId: string;
  suggestionId: string;
  status: 'accepted' | 'dismissed' | 'expired';
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'resolve_slo_owner_handoff_suggestion_phase44',
    {
      p_actor_id: input.actorId,
      p_suggestion_id: input.suggestionId,
      p_status: input.status,
    },
  );
  errorMessage(error);
  return data;
}

export async function recordSloPolicyRevisionPhase44(input: {
  actorId: string;
  policyId: string;
  fromRowVersion: number;
  toRowVersion: number;
  comparisonDigest: string;
  materialRisk: boolean;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('record_slo_policy_revision_phase44', {
    p_actor_id: input.actorId,
    p_policy_id: input.policyId,
    p_from_row_version: input.fromRowVersion,
    p_to_row_version: input.toRowVersion,
    p_comparison_digest: input.comparisonDigest,
    p_material_risk: input.materialRisk,
  });
  errorMessage(error);
  return data;
}

export async function getSloPhase44GovernanceReport() {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('get_slo_phase44_governance_report');
  if (error) {
    console.error('slo phase44 governance report unavailable', error.message);
    return null;
  }
  return data;
}

export async function processSloGovernancePhase44(input?: { actorId?: string }) {
  const sb = await createPersistClient();
  const handoffs = await suggestSloOwnerHandoffsPhase44({ warningDays: 30 });
  let archival: unknown = null;
  if (input?.actorId) {
    const { data, error } = await sb.rpc(
      'archive_expired_slo_simulation_exports_phase43',
      {
        p_actor_id: input.actorId,
        p_limit: 25,
      },
    );
    if (error) {
      console.error('slo phase44 archival tick unavailable', error.message);
    } else {
      archival = data;
    }
  }
  const { data: alerts, error: alertError } = await sb.rpc(
    'scan_slo_phase44_ops_alerts',
    { p_actor_id: input?.actorId ?? null },
  );
  if (alertError) {
    console.error('slo phase44 ops alert scan unavailable', alertError.message);
  }
  return {
    handoffs,
    archival,
    alerts: alertError ? null : alerts,
  };
}

export const PHASE45_SLO_CONTRACT_VERSION = 'phase45-v1';

export async function enqueueSloNightlyScenarioReplayPhase45(input?: {
  actorId?: string;
  scheduledFor?: string | null;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'enqueue_slo_nightly_scenario_replay_phase45',
    {
      p_actor_id: input?.actorId ?? null,
      p_scheduled_for: input?.scheduledFor ?? null,
    },
  );
  errorMessage(error);
  return data;
}

export async function runSloNightlyScenarioReplayPhase45(input: {
  actorId?: string | null;
  limit?: number;
  scheduledFor?: string | null;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'run_slo_nightly_scenario_replay_phase45',
    {
      p_actor_id: input.actorId ?? null,
      p_limit: input.limit ?? 50,
      p_scheduled_for: input.scheduledFor ?? null,
    },
  );
  errorMessage(error);
  return data;
}

export async function generateSloOwnerHandoffDigestPhase45(input?: {
  actorId?: string;
  digestQuarter?: string | null;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'generate_slo_owner_handoff_digest_phase45',
    {
      p_actor_id: input?.actorId ?? null,
      p_digest_quarter: input?.digestQuarter ?? null,
    },
  );
  errorMessage(error);
  return data;
}

export async function getSloPhase45GovernanceReport() {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('get_slo_phase45_governance_report');
  if (error) {
    console.error('slo phase45 governance report unavailable', error.message);
    return null;
  }
  return data;
}

export async function processSloGovernancePhase45(input?: { actorId?: string }) {
  const sb = await createPersistClient();
  let nightly: unknown = null;
  try {
    nightly = await runSloNightlyScenarioReplayPhase45({
      actorId: input?.actorId ?? null,
      limit: 50,
    });
  } catch (error) {
    console.error(
      'slo phase45 nightly replay unavailable',
      error instanceof Error ? error.message : error,
    );
  }

  let digest: unknown = null;
  try {
    digest = await generateSloOwnerHandoffDigestPhase45({
      actorId: input?.actorId,
    });
  } catch (error) {
    console.error(
      'slo phase45 handoff digest unavailable',
      error instanceof Error ? error.message : error,
    );
  }

  const { data: alerts, error: alertError } = await sb.rpc(
    'scan_slo_phase45_ops_alerts',
    { p_actor_id: input?.actorId ?? null },
  );
  if (alertError) {
    console.error('slo phase45 ops alert scan unavailable', alertError.message);
  }

  return {
    nightly,
    digest,
    alerts: alertError ? null : alerts,
  };
}

export const PHASE46_SLO_CONTRACT_VERSION = 'phase46-v1';

export async function runSloFirmWideNightlyReplayPhase46(input?: {
  actorId?: string | null;
  scheduledFor?: string | null;
  scheduleKey?: string | null;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'run_slo_firm_wide_nightly_replay_phase46',
    {
      p_actor_id: input?.actorId ?? null,
      p_scheduled_for: input?.scheduledFor ?? null,
      p_schedule_key: input?.scheduleKey ?? 'firm_wide_nightly',
    },
  );
  errorMessage(error);
  return data;
}

export async function publishSloOwnerHandoffDigestPhase46(input?: {
  actorId?: string;
  digestQuarter?: string | null;
  destinationKey?: string | null;
  recipientCount?: number;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'publish_slo_owner_handoff_digest_phase46',
    {
      p_actor_id: input?.actorId ?? null,
      p_digest_quarter: input?.digestQuarter ?? null,
      p_destination_key: input?.destinationKey ?? 'ops_alerts',
      p_recipient_count: input?.recipientCount ?? 0,
    },
  );
  errorMessage(error);
  return data;
}

export async function getSloPhase46GovernanceReport() {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('get_slo_phase46_governance_report');
  if (error) {
    console.error('slo phase46 governance report unavailable', error.message);
    return null;
  }
  return data;
}

export async function processSloGovernancePhase46(input?: { actorId?: string }) {
  const sb = await createPersistClient();
  let firmWide: unknown = null;
  try {
    firmWide = await runSloFirmWideNightlyReplayPhase46({
      actorId: input?.actorId ?? null,
    });
  } catch (error) {
    console.error(
      'slo phase46 firm-wide nightly replay unavailable',
      error instanceof Error ? error.message : error,
    );
  }

  let publication: unknown = null;
  try {
    publication = await publishSloOwnerHandoffDigestPhase46({
      actorId: input?.actorId,
      recipientCount: 0,
    });
  } catch (error) {
    console.error(
      'slo phase46 handoff digest publish unavailable',
      error instanceof Error ? error.message : error,
    );
  }

  const { data: ownershipAlerts, error: ownershipAlertError } = await sb.rpc(
    'scan_slo_ownership_change_alerts_phase46',
    { p_actor_id: input?.actorId ?? null, p_days_ahead: 60 },
  );
  if (ownershipAlertError) {
    console.error(
      'slo phase46 ownership-change alert scan unavailable',
      ownershipAlertError.message,
    );
  }

  return {
    firmWide,
    publication,
    ownershipAlerts: ownershipAlertError ? null : ownershipAlerts,
  };
}
