import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const REVENUE_TRANSFORM_VERSION = 'phase40-canonical-v1';
export const REVENUE_REPORT_VERSION = 'phase40-v1';
export const MAX_REVENUE_PAGES = 10;
export const MAX_REVENUE_RECORDS = 500;
export const MAX_REVENUE_BODY_BYTES = 1_048_576;

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

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function verifyRevenueAuthenticity(input: {
  mode: 'hmac_sha256' | 'request_id';
  rawBody: string;
  requestId: string;
  signature: string | null;
  signatureSecret?: string;
}): boolean {
  if (input.mode === 'request_id') return input.requestId.length > 0;
  if (!input.signatureSecret || !input.signature) return false;
  const supplied = input.signature.replace(/^sha256=/i, '').toLowerCase();
  if (!hash.safeParse(supplied).success) return false;
  const expected = createHmac('sha256', input.signatureSecret)
    .update(input.rawBody, 'utf8')
    .digest('hex');
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
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
