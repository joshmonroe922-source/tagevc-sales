import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const REVENUE_TRANSFORM_VERSION = 'phase40-canonical-v1';
export const REVENUE_REPORT_VERSION = 'phase40-v1';
export const REVENUE_REPORT_VERSION_PHASE41 = 'phase41-v1';
export const REVENUE_REPORT_VERSION_PHASE42 = 'phase42-v1';
export const REVENUE_REPORT_VERSION_PHASE43 = 'phase43-v1';
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
