import { z } from 'zod';
import {
  REVENUE_AUTHENTICITY_MODES,
  REVENUE_LEDGER_KINDS,
  REVENUE_LEDGER_PROFILES,
  REVENUE_REPORT_VERSION_PHASE41,
  type Phase41RevenueReport,
} from '@/lib/shared-services/marketing-revenue-contracts';
import { createPersistClient } from '@/lib/supabase/persist-client';

const emptySettlementLag = {
  available: false,
  overdue_count: 0,
  settled_late_count: 0,
  max_lag_days: null,
  average_lag_days: null,
  by_status: [],
};

export function emptyPhase41RevenueReport(): Phase41RevenueReport {
  return {
    version: REVENUE_REPORT_VERSION_PHASE41,
    comparison_semantics:
      'Descriptive allocations on aligned cohorts/windows/currencies; differences do not establish causality.',
    expected_records: 0,
    observed_records: 0,
    completeness_percent: null,
    late_records: 0,
    pending_corrections: 0,
    approved_corrections: 0,
    authenticity_modes: [],
    pending_correction_queue: [],
    settlement_lag: emptySettlementLag,
    sources: [],
    model_comparisons: [],
  };
}

export async function getPhase41RevenueReport(input: {
  entityId: string | null;
  firmWide: boolean;
  days: 7 | 30 | 90;
}): Promise<{ report: Phase41RevenueReport; error?: string }> {
  const empty = emptyPhase41RevenueReport();
  if (!input.firmWide && !input.entityId) {
    return {
      report: empty,
      error: 'Entity-scoped revenue report requires an entity',
    };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('get_marketing_revenue_phase41_report', {
    p_entity_id: input.entityId,
    p_days: input.days,
  });
  if (error) return { report: empty, error: error.message };
  const report = data as Phase41RevenueReport | null;
  if (!report || report.version !== REVENUE_REPORT_VERSION_PHASE41) {
    return { report: empty, error: 'Phase 41 revenue report contract mismatch' };
  }
  return {
    report: {
      ...empty,
      ...report,
      authenticity_modes: (report.authenticity_modes ?? []).slice(0, 20),
      pending_correction_queue: (report.pending_correction_queue ?? []).slice(
        0,
        100,
      ),
      settlement_lag: {
        ...emptySettlementLag,
        ...(report.settlement_lag ?? {}),
        by_status: (report.settlement_lag?.by_status ?? []).slice(0, 10),
      },
      sources: (report.sources ?? []).slice(0, 100),
      model_comparisons: (report.model_comparisons ?? []).slice(0, 200),
    },
  };
}

export async function reviewMarketingRevenueCorrection(input: {
  correctionId: string;
  actorId: string;
  decision: 'approved' | 'rejected';
  reason: string;
}): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const parsed = z
    .object({
      correctionId: z.string().uuid(),
      actorId: z.string().uuid(),
      decision: z.enum(['approved', 'rejected']),
      reason: z.string().trim().min(10).max(500),
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid correction review',
    };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('approve_marketing_revenue_correction', {
    p_correction_id: parsed.data.correctionId,
    p_actor_id: parsed.data.actorId,
    p_decision: parsed.data.decision,
    p_review_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, result: data };
}

export const revenueSourceUpsertSchema = z.object({
  source_key: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{2,63}$/),
  display_name: z.string().min(2).max(200),
  entity_id: z.string().min(1).max(100),
  provider: z.enum(['meta_ads', 'linkedin_ads']),
  ad_account_id: z.string().min(1).max(200),
  external_account_id: z.string().min(1).max(300),
  endpoint_url: z.string().url().refine((value) => value.startsWith('https://'), {
    message: 'Endpoint must be HTTPS',
  }),
  credential_env_name: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{2,127}$/),
  signature_env_name: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{2,127}$/)
    .nullable()
    .optional(),
  authenticity_mode: z.enum(REVENUE_AUTHENTICITY_MODES),
  ledger_profile: z.enum(REVENUE_LEDGER_PROFILES).default('sandbox_v1'),
  ledger_kind: z.enum(REVENUE_LEDGER_KINDS).default('ad_platform'),
  config_status: z.enum(['disabled', 'ready', 'invalid']).default('disabled'),
});

export async function upsertMarketingRevenueSource(input: unknown): Promise<
  | { ok: true; source_id: string; source_key: string }
  | { ok: false; error: string }
> {
  const parsed = revenueSourceUpsertSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid revenue source',
    };
  }
  if (
    (parsed.data.authenticity_mode === 'hmac_sha256' ||
      parsed.data.authenticity_mode === 'signed_headers_v1' ||
      parsed.data.authenticity_mode === 'jwt_bearer_v1') &&
    !parsed.data.signature_env_name
  ) {
    return {
      ok: false,
      error: 'Signature-backed authenticity modes require signature_env_name',
    };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('upsert_marketing_revenue_source', {
    p_source: parsed.data,
  });
  if (error) return { ok: false, error: error.message };
  const result = (data ?? {}) as { source_id?: string; source_key?: string };
  if (!result.source_id || !result.source_key) {
    return { ok: false, error: 'Revenue source upsert returned incomplete data' };
  }
  return {
    ok: true,
    source_id: result.source_id,
    source_key: result.source_key,
  };
}

export async function bindMarketingRevenueCampaign(input: {
  sourceId: string;
  sourceCampaignId: string;
  campaignId: string;
}): Promise<{ ok: true; binding_sha256: string } | { ok: false; error: string }> {
  const parsed = z
    .object({
      sourceId: z.string().uuid(),
      sourceCampaignId: z.string().min(1).max(300),
      campaignId: z.string().min(1).max(200),
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid campaign binding',
    };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('bind_marketing_revenue_campaign', {
    p_source_id: parsed.data.sourceId,
    p_source_campaign_id: parsed.data.sourceCampaignId,
    p_campaign_id: parsed.data.campaignId,
  });
  if (error) return { ok: false, error: error.message };
  const binding = (data ?? {}) as { binding_sha256?: string };
  if (!binding.binding_sha256) {
    return { ok: false, error: 'Campaign binding returned incomplete data' };
  }
  return { ok: true, binding_sha256: binding.binding_sha256 };
}
