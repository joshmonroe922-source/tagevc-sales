import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const REVENUE_TRANSFORM_VERSION = 'phase40-canonical-v1';
export const REVENUE_REPORT_VERSION = 'phase40-v1';
export const REVENUE_REPORT_VERSION_PHASE41 = 'phase41-v1';
export const REVENUE_REPORT_VERSION_PHASE42 = 'phase42-v1';
export const REVENUE_REPORT_VERSION_PHASE43 = 'phase43-v1';
export const REVENUE_REPORT_VERSION_PHASE44 = 'phase44-v1';
export const REVENUE_REPORT_VERSION_PHASE45 = 'phase45-v1';
export const REVENUE_REPORT_VERSION_PHASE46 = 'phase46-v1';
export const REVENUE_REPORT_VERSION_PHASE47 = 'phase47-v1';
export const REVENUE_REPORT_VERSION_PHASE48 = 'phase48-v1';
export const REVENUE_SLO_SEVERITIES = [
  'healthy',
  'warning',
  'critical',
  'unknown',
] as const;
export type RevenueSloSeverity = (typeof REVENUE_SLO_SEVERITIES)[number];
export const REVENUE_OPS_ALERT_DELIVERY = [
  'delivered',
  'skipped_no_webhook',
  'failed',
  'recorded',
  'none',
] as const;
export type RevenueOpsAlertDelivery =
  (typeof REVENUE_OPS_ALERT_DELIVERY)[number];
export const REVENUE_BINDING_STATUSES = [
  'healthy',
  'missing_credential',
  'missing_signature',
  'missing_both',
  'unknown',
] as const;
export type RevenueBindingStatus = (typeof REVENUE_BINDING_STATUSES)[number];
export const MAX_REVENUE_PAGES = 10;
export const MAX_REVENUE_RECORDS = 500;
export const MAX_REVENUE_BODY_BYTES = 1_048_576;

export const REVENUE_AUTHENTICITY_MODES = [
  'hmac_sha256',
  'request_id',
  'signed_headers_v1',
  'jwt_bearer_v1',
] as const;

export type RevenueAuthenticityMode =
  (typeof REVENUE_AUTHENTICITY_MODES)[number];

export const REVENUE_LEDGER_PROFILES = ['production_v1', 'sandbox_v1'] as const;
export const REVENUE_LEDGER_KINDS = [
  'ad_platform',
  'production_ledger',
] as const;

const micros = z.string().regex(/^\d{1,18}$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const isoTimestamp = z.string().datetime({ offset: true });

export const authoritativeRevenueRecordSchema = z.object({
  source_record_id: z.string().min(1).max(200),
  revenue_event_id: z.string().min(1).max(200),
  source_revision: z.number().int().min(1).max(10_000),
  correction_reason: z.string().min(10).max(500).nullable().optional(),
  entity_id: z.string().min(1).max(100),
  ad_account_id: z.string().min(1).max(200),
  external_account_id: z.string().min(1).max(300),
  source_campaign_id: z.string().min(1).max(300),
  external_campaign_id: z.string().min(1).max(300),
  cohort_key: z.string().min(1).max(200),
  cohort_window_start: isoTimestamp,
  cohort_window_end: isoTimestamp,
  currency: z.string().regex(/^[A-Z]{3}$/),
  amount_micros: micros,
  attribution_model: z.enum([
    'first_touch',
    'last_touch',
    'linear',
    'position_based',
    'provider_reported',
  ]),
  attribution_window_days: z.number().int().min(1).max(90),
  source_recorded_at: isoTimestamp,
});

export const authoritativeRevenuePageSchema = z.object({
  contract_version: z.literal('authoritative-revenue-v1'),
  request_id: z.string().min(1).max(300),
  next_cursor: z.string().max(1000).nullable(),
  has_more: z.boolean(),
  expected_records: z.number().int().min(0).max(MAX_REVENUE_RECORDS),
  records: z.array(authoritativeRevenueRecordSchema).max(MAX_REVENUE_RECORDS),
});

export type AuthoritativeRevenueRecord = z.infer<
  typeof authoritativeRevenueRecordSchema
>;
export type AuthoritativeRevenuePage = z.infer<
  typeof authoritativeRevenuePageSchema
>;

export type CanonicalRevenueRow = AuthoritativeRevenueRecord & {
  source_payload_sha256: string;
};

export type RevenueReceipt = {
  page_number: number;
  request_id: string;
  fetched_at: string;
  http_status: number;
  body_bytes: number;
  body_sha256: string;
  authenticity_verified: true;
  cursor_in_sha256: string | null;
  cursor_out_sha256: string | null;
  metadata: { content_type: string | null };
};

export type Phase40RevenueReport = {
  version: string;
  comparison_semantics: string;
  expected_records: number;
  observed_records: number;
  completeness_percent: number | null;
  late_records: number;
  pending_corrections: number;
  approved_corrections: number;
  sources: Array<{
    source_id: string;
    source_key: string;
    display_name: string;
    config_status: string;
    authenticity_status: string;
    authenticity_mode?: string;
    ledger_profile?: string;
    ledger_kind?: string;
    checkpoint_at: string | null;
    run_count: number;
    expected_records: number;
    observed_records: number;
    late_records: number;
    staged_corrections: number;
    failed_runs: number;
    reconciliation_status: string;
  }>;
  model_comparisons: Array<{
    cohort_key: string;
    cohort_window_start: string;
    cohort_window_end: string;
    currency: string;
    attribution_window_days: number;
    model_count: number;
    event_count: number;
    attribution_model: string;
    amount_micros: string;
  }>;
};

export type Phase41PendingCorrection = {
  correction_id: string;
  source_id: string;
  source_key: string;
  entity_id: string;
  proposed_revision: number;
  reason: string;
  proposed_canonical_sha256: string;
  created_at: string;
  revenue_event_id: string;
  attribution_model: string;
  currency: string;
  amount_micros: string;
};

export type Phase41SettlementLag = {
  available: boolean;
  overdue_count: number;
  settled_late_count: number;
  max_lag_days: number | null;
  average_lag_days: number | null;
  by_status: Array<{
    lag_status: string;
    evidence_count: number;
    max_lag_days: number | null;
    average_lag_days: number | null;
  }>;
};

export type Phase41RevenueReport = Phase40RevenueReport & {
  version: typeof REVENUE_REPORT_VERSION_PHASE41 | string;
  authenticity_modes: Array<{
    authenticity_mode: string;
    source_count: number;
    verified_count: number;
    failed_count: number;
    unchecked_count: number;
  }>;
  pending_correction_queue: Phase41PendingCorrection[];
  settlement_lag: Phase41SettlementLag;
};

export type Phase42AuthenticitySloSnapshot = {
  snapshot_id: string;
  entity_id: string;
  source_id: string;
  ledger_profile: string;
  authenticity_mode: string;
  window_days: number;
  probe_count: number;
  fail_count: number;
  fail_rate: number | null;
  severity: RevenueSloSeverity | string;
  metrics_sha256: string;
  created_at: string;
};

export type Phase42SettlementSloSnapshot = {
  snapshot_id: string;
  entity_id: string;
  window_days: number;
  evidence_count: number;
  overdue_count: number;
  settled_late_count: number;
  overdue_rate: number | null;
  late_rate: number | null;
  severity: RevenueSloSeverity | string;
  metrics_sha256: string;
  created_at: string;
};

export type Phase42RevenueSloReport = {
  version: typeof REVENUE_REPORT_VERSION_PHASE42 | string;
  window_days: number;
  authenticity_severity: RevenueSloSeverity | string;
  settlement_severity: RevenueSloSeverity | string;
  overall_severity: RevenueSloSeverity | string;
  authenticity_snapshots: Phase42AuthenticitySloSnapshot[];
  settlement_snapshots: Phase42SettlementSloSnapshot[];
  thresholds: {
    authenticity_fail_rate: { warning: number; critical: number };
    settlement_rate: { warning: number; critical: number };
  };
};

export type Phase43CredentialBinding = {
  binding_id: string;
  entity_id: string;
  source_id: string;
  ledger_profile: string;
  authenticity_mode: string;
  credential_env_name: string;
  signature_env_name: string | null;
  credential_env_present: boolean;
  signature_env_present: boolean | null;
  signature_env_required: boolean;
  binding_status: RevenueBindingStatus | string;
  metrics_sha256: string;
  created_at: string;
};

export type Phase43OpsAlert = {
  alert_id: string;
  entity_id: string;
  source_id: string | null;
  alert_kind:
    | 'authenticity_critical'
    | 'settlement_critical'
    | 'credential_binding'
    | string;
  window_key: string;
  severity: 'critical' | string;
  destination_key: string;
  delivery_status: RevenueOpsAlertDelivery | string;
  response_code: number | null;
  metrics_sha256: string;
  created_at: string;
};

export type Phase43RevenueOpsReport = {
  version: typeof REVENUE_REPORT_VERSION_PHASE43 | string;
  window_days: number;
  binding_health: RevenueSloSeverity | string;
  alert_delivery: RevenueOpsAlertDelivery | string;
  critical_alert_count: number;
  bindings: Phase43CredentialBinding[];
  alerts: Phase43OpsAlert[];
  destination_key: string;
};

export const REVENUE_CORRECTION_VALIDATION_STATUSES = [
  'passed',
  'failed',
  'auto_rejected',
] as const;
export type RevenueCorrectionValidationStatus =
  (typeof REVENUE_CORRECTION_VALIDATION_STATUSES)[number];

export const REVENUE_ATTRIBUTION_CONFLICT_KINDS = [
  'event_set_mismatch',
  'amount_delta_threshold',
  'model_count_gap',
] as const;
export type RevenueAttributionConflictKind =
  (typeof REVENUE_ATTRIBUTION_CONFLICT_KINDS)[number];

export const REVENUE_ATTRIBUTION_RESOLUTION_STATUSES = [
  'open',
  'proposed',
  'approved',
  'rejected',
] as const;
export type RevenueAttributionResolutionStatus =
  (typeof REVENUE_ATTRIBUTION_RESOLUTION_STATUSES)[number];

export const REVENUE_RECONCILIATION_STATUSES = [
  'complete',
  'incomplete',
  'failed',
  'denominator_inconsistent',
  'unavailable',
] as const;
export type RevenueReconciliationStatus =
  (typeof REVENUE_RECONCILIATION_STATUSES)[number];

export type Phase44CorrectionValidation = {
  validation_id: string;
  correction_id: string;
  entity_id: string;
  validation_status: RevenueCorrectionValidationStatus | string;
  fail_reason: string | null;
  age_hours: number;
  metrics_sha256: string;
  created_at: string;
};

export type Phase44AttributionConflict = {
  conflict_id: string;
  conflict_key: string;
  entity_id: string;
  window_start: string;
  window_end: string;
  currency: string;
  window_days: number;
  conflict_kind: RevenueAttributionConflictKind | string;
  model_digests: unknown[];
  metrics_sha256: string;
  resolution_status: RevenueAttributionResolutionStatus | string;
  resolution_reason: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
};

export type Phase44ReconciliationSnapshot = {
  snapshot_id: string;
  entity_id: string;
  source_id: string | null;
  reconciliation_status: RevenueReconciliationStatus | string;
  expected_count: number;
  observed_count: number;
  completeness_pct: number | null;
  late_records: number;
  staged_corrections: number;
  metrics_sha256: string;
  created_at: string;
};

export type Phase44OpsAlert = {
  alert_id: string;
  entity_id: string;
  source_id: string | null;
  alert_kind:
    | 'correction_queue_critical'
    | 'correction_validation_failed'
    | 'attribution_conflict'
    | 'recon_incomplete'
    | 'recon_denominator_inconsistent'
    | 'late_records_critical'
    | string;
  window_key: string;
  severity: 'critical' | string;
  destination_key: string;
  delivery_status: RevenueOpsAlertDelivery | string;
  response_code: number | null;
  metrics_sha256: string;
  created_at: string;
};

export type Phase44RevenueOpsReport = {
  version: typeof REVENUE_REPORT_VERSION_PHASE44 | string;
  window_days: number;
  correction_validation_health: RevenueSloSeverity | string;
  conflict_open_count: number;
  recon_health: RevenueSloSeverity | string;
  alert_delivery: RevenueOpsAlertDelivery | string;
  validations: Phase44CorrectionValidation[];
  conflicts: Phase44AttributionConflict[];
  snapshots: Phase44ReconciliationSnapshot[];
  alerts: Phase44OpsAlert[];
  destination_key: string;
};

export const REVENUE_PHASE45_ALERT_KINDS = [
  'webhook_delivery_critical',
  'auto_reject_rule_tuned',
  'correction_workflow_stale',
  'validation_fail_rate_elevated',
] as const;
export type RevenuePhase45AlertKind =
  (typeof REVENUE_PHASE45_ALERT_KINDS)[number];

export type Phase45AutoRejectRuleVersion = {
  version_id: string;
  version_no: number;
  rule_key: string;
  thresholds: Record<string, unknown>;
  status: 'proposed' | 'active' | string;
  proposed_version_id: string | null;
  metrics_sha256: string;
  created_at: string;
  created_by: string | null;
};

export type Phase45WebhookDeliverySloSnapshot = {
  snapshot_id: string;
  entity_id: string | null;
  window_start: string;
  window_end: string;
  delivered_count: number;
  failed_count: number;
  skipped_count: number;
  recorded_count: number;
  success_rate: number | null;
  severity: RevenueSloSeverity | string;
  metrics_sha256: string;
  created_at: string;
};

export type Phase45CorrectionWorkflowSnapshot = {
  snapshot_id: string;
  entity_id: string | null;
  pending_count: number;
  validated_passed: number;
  validated_failed: number;
  auto_rejected: number;
  oldest_pending_hours: number | null;
  pass_rate: number | null;
  auto_reject_rate: number | null;
  metrics_sha256: string;
  created_at: string;
};

export type Phase45OpsAlert = {
  alert_id: string;
  entity_id: string;
  source_id: string | null;
  alert_kind: RevenuePhase45AlertKind | string;
  window_key: string;
  severity: 'critical' | string;
  destination_key: string;
  delivery_status: RevenueOpsAlertDelivery | string;
  response_code: number | null;
  metrics_sha256: string;
  created_at: string;
};

export type Phase45RevenueOpsReport = {
  version: typeof REVENUE_REPORT_VERSION_PHASE45 | string;
  window_days: number;
  webhook_delivery_health: RevenueSloSeverity | string;
  workflow_health: RevenueSloSeverity | string;
  alert_delivery: RevenueOpsAlertDelivery | string;
  active_rule: Phase45AutoRejectRuleVersion | null;
  thresholds: Record<string, unknown>;
  webhook_snapshots: Phase45WebhookDeliverySloSnapshot[];
  workflow_snapshots: Phase45CorrectionWorkflowSnapshot[];
  rule_versions: Phase45AutoRejectRuleVersion[];
  alerts: Phase45OpsAlert[];
  destination_key: string;
};

export const REVENUE_PHASE46_ALERT_KINDS = [
  'auto_reject_promotion_blocked',
  'auto_reject_promoted',
  'webhook_reliability_degraded',
  'rule_performance_anomaly',
] as const;
export type RevenuePhase46AlertKind =
  (typeof REVENUE_PHASE46_ALERT_KINDS)[number];

export type Phase46PromotionGate = {
  version?: string;
  gate_passed: boolean;
  entity_id?: string | null;
  webhook_slo_windows_required: number;
  webhook_slo_windows_healthy: number;
  windows_sampled?: number;
  latest_severity?: string | null;
  latest_success_rate?: number | null;
  block_reason?: string | null;
};

export type Phase46AutoRejectPromotion = {
  promotion_id: string;
  rule_version_id: string | null;
  version_no: number | null;
  webhook_slo_windows_required: number;
  webhook_slo_windows_healthy: number;
  promotion_status: 'blocked' | 'promoted' | 'rejected' | string;
  block_reason: string | null;
  metrics_sha256: string;
  created_at: string;
  actor_id: string | null;
};

export type Phase46AutoRejectPerformanceSnapshot = {
  snapshot_id: string;
  entity_id: string | null;
  rule_version_id: string | null;
  rule_key: string;
  version_no: number | null;
  auto_reject_count: number;
  validation_pass_count: number;
  fail_count: number;
  auto_reject_rate: number | null;
  validation_pass_rate: number | null;
  fail_rate: number | null;
  precision_rate: number | null;
  metrics_sha256: string;
  created_at: string;
};

export type Phase46WebhookReliabilitySnapshot = {
  snapshot_id: string;
  entity_id: string | null;
  window_start: string;
  window_end: string;
  rolling_success_rate: number | null;
  consecutive_healthy_windows: number;
  windows_sampled: number;
  severity: RevenueSloSeverity | string;
  metrics_sha256: string;
  created_at: string;
};

export type Phase46OpsAlert = {
  alert_id: string;
  entity_id: string;
  source_id: string | null;
  alert_kind: RevenuePhase46AlertKind | string;
  window_key: string;
  severity: 'critical' | string;
  destination_key: string;
  delivery_status: RevenueOpsAlertDelivery | string;
  response_code: number | null;
  metrics_sha256: string;
  created_at: string;
};

export type Phase46RevenueOpsReport = {
  version: typeof REVENUE_REPORT_VERSION_PHASE46 | string;
  window_days: number;
  promotion_gate_health: RevenueSloSeverity | string;
  webhook_reliability_health: RevenueSloSeverity | string;
  rule_performance_health: RevenueSloSeverity | string;
  alert_delivery: RevenueOpsAlertDelivery | string;
  promotion_gate: Phase46PromotionGate | null;
  thresholds: Record<string, unknown>;
  promotions: Phase46AutoRejectPromotion[];
  performance_snapshots: Phase46AutoRejectPerformanceSnapshot[];
  reliability_snapshots: Phase46WebhookReliabilitySnapshot[];
  alerts: Phase46OpsAlert[];
  destination_key: string;
};

export const REVENUE_PHASE47_ALERT_KINDS = [
  'cohort_promotion_blocked',
  'cohort_promoted',
  'attribution_conflict_aging',
  'conflict_closure_pending',
] as const;
export type RevenuePhase47AlertKind =
  (typeof REVENUE_PHASE47_ALERT_KINDS)[number];

export const REVENUE_CONFLICT_CLOSURE_STATUSES = [
  'proposed',
  'approved',
  'rejected',
  'closed',
] as const;
export type RevenueConflictClosureStatus =
  (typeof REVENUE_CONFLICT_CLOSURE_STATUSES)[number];

export type Phase47PromotionCohort = {
  cohort_id: string;
  cohort_key: string;
  entity_ids: string[];
  status: 'active' | 'retired' | string;
  firm_wide?: boolean;
  metrics_sha256: string;
  created_at: string;
  created_by: string | null;
};

export type Phase47CohortPromotionGate = {
  version?: string;
  gate_passed: boolean;
  cohort_id?: string | null;
  cohort_key?: string | null;
  firm_wide?: boolean;
  webhook_slo_windows_required: number;
  webhook_slo_windows_healthy: number;
  entities_required?: number;
  entities_healthy?: number;
  entity_gates?: unknown[];
  block_reason?: string | null;
};

export type Phase47CohortPromotion = {
  promotion_id: string;
  cohort_id: string;
  rule_version_id: string | null;
  version_no: number | null;
  webhook_slo_windows_required: number;
  webhook_slo_windows_healthy: number;
  entities_required: number;
  entities_healthy: number;
  promotion_status: 'blocked' | 'promoted' | 'rejected' | string;
  block_reason: string | null;
  metrics_sha256: string;
  created_at: string;
  actor_id: string | null;
};

export type Phase47AttributionConflictClosure = {
  closure_id: string;
  conflict_id: string;
  closure_status: RevenueConflictClosureStatus | string;
  resolution_notes: string;
  closed_by: string;
  metrics_sha256: string;
  created_at: string;
  entity_id?: string | null;
};

export type Phase47AgingConflict = {
  conflict_id: string;
  conflict_key: string;
  entity_id: string;
  conflict_kind: string;
  resolution_status: string;
  age_days: number;
  age_hours: number;
  metrics_sha256: string;
  created_at: string;
  has_pending_closure?: boolean;
};

export type Phase47OpsAlert = {
  alert_id: string;
  entity_id: string;
  source_id: string | null;
  cohort_id?: string | null;
  conflict_id?: string | null;
  alert_kind: RevenuePhase47AlertKind | string;
  window_key: string;
  severity: 'critical' | string;
  destination_key: string;
  delivery_status: RevenueOpsAlertDelivery | string;
  response_code: number | null;
  metrics_sha256: string;
  created_at: string;
};

export type Phase47RevenueOpsReport = {
  version: typeof REVENUE_REPORT_VERSION_PHASE47 | string;
  window_days: number;
  cohort_gate_health: RevenueSloSeverity | string;
  conflict_aging_health: RevenueSloSeverity | string;
  closure_health: RevenueSloSeverity | string;
  alert_delivery: RevenueOpsAlertDelivery | string;
  open_aging_count: number;
  pending_closure_count: number;
  cohort_gate: Phase47CohortPromotionGate | null;
  thresholds: Record<string, unknown>;
  cohorts: Phase47PromotionCohort[];
  cohort_promotions: Phase47CohortPromotion[];
  conflict_closures: Phase47AttributionConflictClosure[];
  aging_conflicts: Phase47AgingConflict[];
  alerts: Phase47OpsAlert[];
  destination_key: string;
};

export const REVENUE_PHASE48_ALERT_KINDS = [
  'autopilot_promoted',
  'autopilot_blocked',
  'conflict_cohort_archived',
  'cohort_performance_degraded',
] as const;
export type RevenuePhase48AlertKind =
  (typeof REVENUE_PHASE48_ALERT_KINDS)[number];

export const REVENUE_AUTOPILOT_RUN_STATUSES = [
  'waiting',
  'promoted',
  'blocked',
  'skipped',
] as const;
export type RevenueAutopilotRunStatus =
  (typeof REVENUE_AUTOPILOT_RUN_STATUSES)[number];

export type Phase48CohortAutopilotRun = {
  run_id: string;
  cohort_id: string;
  promotion_id: string | null;
  gate_passed: boolean;
  consecutive_healthy_windows: number;
  windows_required: number;
  run_status: RevenueAutopilotRunStatus | string;
  block_reason: string | null;
  metrics_sha256: string;
  created_at: string;
  actor_id: string | null;
  cohort_key?: string | null;
};

export type Phase48ConflictCohortArchive = {
  archive_id: string;
  archive_key: string;
  entity_id: string;
  conflict_kind: string;
  conflict_ids: string[];
  conflict_count: number;
  closed_count: number;
  metrics_sha256: string;
  created_at: string;
  archived_by: string | null;
};

export type Phase48CohortPerformanceSnapshot = {
  snapshot_id: string;
  cohort_id: string | null;
  entity_id: string | null;
  promotions_total: number;
  promotions_promoted: number;
  promotions_blocked: number;
  autopilot_runs: number;
  autopilot_promoted: number;
  open_conflicts: number;
  closed_conflicts: number;
  archived_conflicts: number;
  pending_closures: number;
  promote_rate: number | null;
  close_rate: number | null;
  severity: RevenueSloSeverity | string;
  metrics_sha256: string;
  created_at: string;
};

export type Phase48OpsAlert = {
  alert_id: string;
  entity_id: string;
  source_id: string | null;
  cohort_id?: string | null;
  archive_id?: string | null;
  alert_kind: RevenuePhase48AlertKind | string;
  window_key: string;
  severity: 'critical' | string;
  destination_key: string;
  delivery_status: RevenueOpsAlertDelivery | string;
  response_code: number | null;
  metrics_sha256: string;
  created_at: string;
};

export type Phase48RevenueOpsReport = {
  version: typeof REVENUE_REPORT_VERSION_PHASE48 | string;
  window_days: number;
  autopilot_health: RevenueSloSeverity | string;
  archive_health: RevenueSloSeverity | string;
  cohort_performance_health: RevenueSloSeverity | string;
  conflict_resolution_health: RevenueSloSeverity | string;
  alert_delivery: RevenueOpsAlertDelivery | string;
  autopilot_waiting_count: number;
  autopilot_promoted_count: number;
  autopilot_blocked_count: number;
  archives_count: number;
  open_aging_count: number;
  pending_closure_count: number;
  thresholds: Record<string, unknown>;
  autopilot_runs: Phase48CohortAutopilotRun[];
  conflict_archives: Phase48ConflictCohortArchive[];
  performance_snapshots: Phase48CohortPerformanceSnapshot[];
  aging_conflicts: Phase47AgingConflict[];
  alerts: Phase48OpsAlert[];
  destination_key: string;
};

export type AuthenticityProbeEvidence = {
  request_id_sha256: string | null;
  body_sha256: string;
  header_digest_sha256: string | null;
  claims_digest_sha256: string | null;
  metadata: { content_type?: string | null; alg?: string | null; kid?: string | null };
};

function safeEqualHex(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(supplied, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function decodeJwtPart(part: string): unknown {
  const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    '=',
  );
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function verifyRevenueAuthenticity(input: {
  mode: RevenueAuthenticityMode;
  rawBody: string;
  requestId: string;
  signature: string | null;
  signatureSecret?: string;
  contentSha256Header?: string | null;
  sourceJwt?: string | null;
}): { ok: boolean; evidence: AuthenticityProbeEvidence } {
  const bodySha = sha256(input.rawBody);
  const requestIdSha =
    input.requestId.length > 0 ? sha256(input.requestId) : null;
  const baseEvidence: AuthenticityProbeEvidence = {
    request_id_sha256: requestIdSha,
    body_sha256: bodySha,
    header_digest_sha256: null,
    claims_digest_sha256: null,
    metadata: {},
  };

  if (input.mode === 'request_id') {
    return { ok: input.requestId.length > 0, evidence: baseEvidence };
  }

  if (!input.signatureSecret) {
    return { ok: false, evidence: baseEvidence };
  }

  if (input.mode === 'hmac_sha256') {
    if (!input.signature) return { ok: false, evidence: baseEvidence };
    const supplied = input.signature.replace(/^sha256=/i, '').toLowerCase();
    if (!hash.safeParse(supplied).success) {
      return { ok: false, evidence: baseEvidence };
    }
    const expected = createHmac('sha256', input.signatureSecret)
      .update(input.rawBody, 'utf8')
      .digest('hex');
    return {
      ok: safeEqualHex(expected, supplied),
      evidence: baseEvidence,
    };
  }

  if (input.mode === 'signed_headers_v1') {
    const contentHeader = (input.contentSha256Header ?? '').toLowerCase();
    if (!hash.safeParse(contentHeader).success || !safeEqualHex(bodySha, contentHeader)) {
      return { ok: false, evidence: baseEvidence };
    }
    if (!input.signature || input.requestId.length === 0) {
      return { ok: false, evidence: baseEvidence };
    }
    const canonical = `${input.requestId}\n${bodySha}`;
    const headerDigest = sha256(canonical);
    const supplied = input.signature.replace(/^sha256=/i, '').toLowerCase();
    if (!hash.safeParse(supplied).success) {
      return {
        ok: false,
        evidence: { ...baseEvidence, header_digest_sha256: headerDigest },
      };
    }
    const expected = createHmac('sha256', input.signatureSecret)
      .update(canonical, 'utf8')
      .digest('hex');
    return {
      ok: safeEqualHex(expected, supplied),
      evidence: { ...baseEvidence, header_digest_sha256: headerDigest },
    };
  }

  // jwt_bearer_v1 — fail closed on missing/malformed token, alg, claims, or expiry
  const token = input.sourceJwt?.trim() ?? '';
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return { ok: false, evidence: baseEvidence };
  }
  try {
    const header = decodeJwtPart(parts[0]) as {
      alg?: string;
      kid?: string;
      typ?: string;
    };
    if (header.alg !== 'HS256') {
      return {
        ok: false,
        evidence: {
          ...baseEvidence,
          metadata: { alg: header.alg ?? null, kid: header.kid },
        },
      };
    }
    const signingInput = `${parts[0]}.${parts[1]}`;
    const expectedSig = createHmac('sha256', input.signatureSecret)
      .update(signingInput, 'utf8')
      .digest('base64url');
    if (!safeEqualHex(expectedSig, parts[2])) {
      return {
        ok: false,
        evidence: {
          ...baseEvidence,
          metadata: { alg: 'HS256', kid: header.kid },
        },
      };
    }
    const claims = decodeJwtPart(parts[1]) as {
      request_id?: string;
      body_sha256?: string;
      exp?: number;
    };
    const claimsDigest = sha256(
      JSON.stringify({
        request_id: claims.request_id ?? null,
        body_sha256: claims.body_sha256 ?? null,
        exp: claims.exp ?? null,
      }),
    );
    const evidence: AuthenticityProbeEvidence = {
      ...baseEvidence,
      claims_digest_sha256: claimsDigest,
      metadata: { alg: 'HS256', kid: header.kid },
    };
    if (
      typeof claims.request_id !== 'string' ||
      claims.request_id !== input.requestId ||
      typeof claims.body_sha256 !== 'string' ||
      !safeEqualHex(bodySha, claims.body_sha256.toLowerCase())
    ) {
      return { ok: false, evidence };
    }
    if (
      typeof claims.exp === 'number' &&
      Number.isFinite(claims.exp) &&
      claims.exp * 1000 < Date.now()
    ) {
      return { ok: false, evidence };
    }
    return { ok: true, evidence };
  } catch {
    return { ok: false, evidence: baseEvidence };
  }
}

export function canonicalizeRevenueRecord(
  record: AuthoritativeRevenueRecord,
): CanonicalRevenueRow {
  const parsed = authoritativeRevenueRecordSchema.parse(record);
  if (Date.parse(parsed.cohort_window_end) < Date.parse(parsed.cohort_window_start)) {
    throw new Error('Revenue cohort window ends before it starts');
  }
  if (parsed.source_revision > 1 && !parsed.correction_reason) {
    throw new Error('Corrected source revision requires a correction reason');
  }
  return {
    ...parsed,
    source_payload_sha256: sha256(JSON.stringify(parsed)),
  };
}
