import { z } from 'zod';
import { createPersistClient } from '@/lib/supabase/persist-client';

export const ATTRIBUTION_REPORT_VERSION = 'phase39-v2';
export const ATTRIBUTION_MODELS = [
  'first_touch',
  'last_touch',
  'linear',
  'position_based',
  'provider_reported',
] as const;
export const SETTLEMENT_STATUSES = [
  'pending',
  'partial',
  'settled',
  'reversed',
] as const;
const MICROS_SCALE = BigInt(1_000_000);
const BIGINT_ZERO = BigInt(0);

function isNonEmptyJsonObject(value: string): boolean {
  try {
    const decoded = JSON.parse(value) as unknown;
    return Boolean(
      decoded &&
        !Array.isArray(decoded) &&
        typeof decoded === 'object' &&
        Object.keys(decoded).length > 0,
    );
  } catch {
    return false;
  }
}

const amountText = z
  .string()
  .regex(/^\d{1,12}(?:\.\d{1,6})?$/)
  .transform((value) => {
    const [whole, fraction = ''] = value.split('.');
    return `${whole}.${fraction.padEnd(6, '0')}`;
  });

export const paidRevenueEvidenceSchema = z
  .object({
    idempotency_key: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9:_./-]{7,199}$/),
    entity_id: z.string().min(1).max(100),
    provider: z.enum(['meta_ads', 'linkedin_ads']),
    ad_account_id: z.string().min(1).max(200),
    external_account_id: z.string().min(1).max(300),
    campaign_id: z.string().min(1).max(200),
    external_campaign_id: z.string().min(1).max(300),
    revenue_event_id: z.string().min(1).max(200),
    revenue_occurred_at: z.string().datetime({ offset: true }),
    currency: z.string().regex(/^[A-Za-z]{3}$/).transform((v) => v.toUpperCase()),
    attributed_amount: amountText,
    settled_amount: amountText,
    settlement_status: z.enum(SETTLEMENT_STATUSES),
    expected_settlement_at: z.string().datetime({ offset: true }).nullable(),
    settled_at: z.string().datetime({ offset: true }).nullable(),
    attribution_window_days: z.number().int().min(1).max(90),
    attribution_model: z.enum(ATTRIBUTION_MODELS),
    attribution_model_version: z.string().min(1).max(100),
    source_system: z.string().min(1).max(100),
    source_record_id: z.string().min(1).max(200),
    source_recorded_at: z.string().datetime({ offset: true }),
    source_payload_json: z
      .string()
      .refine(isNonEmptyJsonObject, {
        message: 'Source payload must not be empty',
      })
      .refine(
        (value) => new TextEncoder().encode(value).length <= 16_384,
        { message: 'Source payload exceeds 16 KiB' },
      ),
    revision: z.number().int().min(1).max(10_000),
    supersedes_evidence_id: z.string().uuid().nullable(),
  })
  .superRefine((value, ctx) => {
    const attributed = decimalToMicros(value.attributed_amount);
    const settled = decimalToMicros(value.settled_amount);
    const validState =
      (value.settlement_status === 'pending' &&
        settled === BIGINT_ZERO &&
        value.settled_at === null) ||
      (value.settlement_status === 'partial' &&
        settled > BIGINT_ZERO &&
        settled < attributed &&
        value.settled_at === null) ||
      (value.settlement_status === 'settled' &&
        settled === attributed &&
        value.settled_at !== null) ||
      (value.settlement_status === 'reversed' &&
        settled === BIGINT_ZERO &&
        value.expected_settlement_at === null &&
        value.settled_at === null);
    if (!validState) {
      ctx.addIssue({
        code: 'custom',
        path: ['settlement_status'],
        message: 'Settlement status, amount, and settled timestamp disagree',
      });
    }
    const revenueAt = Date.parse(value.revenue_occurred_at);
    const sourceAt = Date.parse(value.source_recorded_at);
    const expectedAt = value.expected_settlement_at
      ? Date.parse(value.expected_settlement_at)
      : null;
    const settledAt = value.settled_at ? Date.parse(value.settled_at) : null;
    if (
      sourceAt < revenueAt ||
      (expectedAt !== null && expectedAt < revenueAt) ||
      (expectedAt !== null &&
        expectedAt > revenueAt + 365 * 24 * 60 * 60 * 1000) ||
      (settledAt !== null &&
        (settledAt < revenueAt || settledAt > sourceAt)) ||
      (value.settlement_status !== 'reversed' && expectedAt === null)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['source_recorded_at'],
        message: 'Evidence timestamps are not chronologically consistent',
      });
    }
    if (
      value.settlement_status === 'reversed' &&
      (attributed !== BIGINT_ZERO || settled !== BIGINT_ZERO)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['attributed_amount'],
        message: 'A reversal revision must carry zero current-state amounts',
      });
    }
    if (
      (value.revision === 1 && value.supersedes_evidence_id !== null) ||
      (value.revision > 1 && value.supersedes_evidence_id === null)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['supersedes_evidence_id'],
        message: 'Revision lineage is incomplete',
      });
    }
  });

export type PaidRevenueEvidenceInput = z.input<
  typeof paidRevenueEvidenceSchema
>;
export type PaidAttributionReport = {
  version: string;
  expected_days: number;
  coverage_status: 'complete' | 'incomplete' | 'unavailable';
  current_evidence_count: number;
  revision_count: number;
  late_revision_count: number;
  unverified_current_count: number;
  oldest_unsettled_at: string | null;
  currency_group_count: number;
  currency_groups_truncated: boolean;
  campaign_group_count: number;
  campaign_groups_truncated: boolean;
  currencies: Array<{
    currency: string;
    attributed_amount_micros: string;
    settled_amount_micros: string;
    unsettled_amount_micros: string;
    evidence_count: number;
    overdue_count: number;
    settled_late_count: number;
  }>;
  campaigns: Array<{
    campaign_id: string;
    external_campaign_id: string;
    provider: string;
    ad_account_id: string;
    currency: string;
    attribution_model: string;
    attribution_model_version: string;
    attribution_window_days: number;
    attributed_amount_micros: string;
    settled_amount_micros: string;
    evidence_count: number;
    overdue_count: number;
    max_lag_days: number | null;
  }>;
  lag: Array<{
    lag_status: string;
    evidence_count: number;
    max_lag_days: number | null;
    average_lag_days: number | null;
  }>;
  recent_evidence: Array<{
    evidence_id: string;
    entity_id: string;
    campaign_id: string;
    provider: string;
    currency: string;
    attributed_amount_micros: string;
    settled_amount_micros: string;
    settlement_status: string;
    lag_status: string;
    settlement_lag_days: number | null;
    revision: number;
    revenue_occurred_at: string;
    expected_settlement_at: string | null;
    settled_at: string | null;
    attribution_model: string;
    attribution_model_version: string;
    attribution_window_days: number;
    source_system: string;
    source_record_id: string;
    evidence_sha256: string;
  }>;
};

export function decimalToMicros(value: string): bigint {
  if (!/^\d{1,12}(?:\.\d{1,6})?$/.test(value)) {
    throw new Error('Amount must be a non-negative decimal with at most 6 places');
  }
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * MICROS_SCALE + BigInt(fraction.padEnd(6, '0'));
}

export function formatMicros(value: string, currency: string): string {
  const micros = BigInt(value);
  const whole = micros / MICROS_SCALE;
  const fraction = (micros % MICROS_SCALE).toString().padStart(6, '0');
  return `${currency} ${whole.toLocaleString()}.${fraction.slice(0, 2)}`;
}

export async function recordPaidRevenueEvidence(
  input: PaidRevenueEvidenceInput,
  actorId: string,
): Promise<
  | { ok: true; evidenceId: string; created: boolean }
  | { ok: false; error: string }
> {
  const parsed = paidRevenueEvidenceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid revenue evidence',
    };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'record_marketing_paid_revenue_evidence',
    { p_evidence: parsed.data, p_actor_id: actorId },
  );
  if (error) return { ok: false, error: error.message };
  const result = (data ?? {}) as {
    evidence_id?: string;
    created?: boolean;
  };
  if (!result.evidence_id) {
    return { ok: false, error: 'Revenue evidence result was incomplete' };
  }
  return {
    ok: true,
    evidenceId: result.evidence_id,
    created: result.created === true,
  };
}

export async function getPaidAttributionReport(input: {
  entityId: string | null;
  firmWide: boolean;
  days: 7 | 30 | 90;
}): Promise<{ report: PaidAttributionReport; error?: string }> {
  const empty: PaidAttributionReport = {
    version: ATTRIBUTION_REPORT_VERSION,
    expected_days: input.days,
    coverage_status: 'unavailable',
    current_evidence_count: 0,
    revision_count: 0,
    late_revision_count: 0,
    unverified_current_count: 0,
    oldest_unsettled_at: null,
    currency_group_count: 0,
    currency_groups_truncated: false,
    campaign_group_count: 0,
    campaign_groups_truncated: false,
    currencies: [],
    campaigns: [],
    lag: [],
    recent_evidence: [],
  };
  if (!input.firmWide && !input.entityId) {
    return {
      report: empty,
      error: 'Entity-scoped attribution report requires an entity',
    };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'get_marketing_paid_attribution_report',
    { p_entity_id: input.entityId, p_days: input.days },
  );
  if (error) return { report: empty, error: error.message };
  const report = data as PaidAttributionReport | null;
  if (!report || report.version !== ATTRIBUTION_REPORT_VERSION) {
    return { report: empty, error: 'Attribution report contract mismatch' };
  }
  return {
    report: {
      ...empty,
      ...report,
      currencies: (report.currencies ?? []).slice(0, 50),
      campaigns: (report.campaigns ?? []).slice(0, 200),
      lag: (report.lag ?? []).slice(0, 10),
      recent_evidence: (report.recent_evidence ?? []).slice(0, 200),
    },
  };
}
