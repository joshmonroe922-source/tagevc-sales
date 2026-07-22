import { createClient } from '@supabase/supabase-js';
import {
  REVENUE_REPORT_VERSION_PHASE42,
  type Phase42RevenueSloReport,
} from '@/lib/shared-services/marketing-revenue-contracts';
import { createPersistClient } from '@/lib/supabase/persist-client';

const emptyThresholds = {
  authenticity_fail_rate: { warning: 0.01, critical: 0.05 },
  settlement_rate: { warning: 0.05, critical: 0.15 },
};

export function emptyPhase42RevenueSloReport(): Phase42RevenueSloReport {
  return {
    version: REVENUE_REPORT_VERSION_PHASE42,
    window_days: 30,
    authenticity_severity: 'unknown',
    settlement_severity: 'unknown',
    overall_severity: 'unknown',
    authenticity_snapshots: [],
    settlement_snapshots: [],
    thresholds: emptyThresholds,
  };
}

export async function getPhase42RevenueSloReport(input: {
  entityId: string | null;
  firmWide: boolean;
  days: 7 | 30 | 90;
}): Promise<{ report: Phase42RevenueSloReport; error?: string }> {
  const empty = emptyPhase42RevenueSloReport();
  if (!input.firmWide && !input.entityId) {
    return {
      report: empty,
      error: 'Entity-scoped Phase 42 SLO report requires an entity',
    };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'get_marketing_revenue_phase42_slo_report',
    {
      p_entity_id: input.entityId,
      p_days: input.days,
    },
  );
  if (error) return { report: empty, error: error.message };
  const report = data as Phase42RevenueSloReport | null;
  if (!report || report.version !== REVENUE_REPORT_VERSION_PHASE42) {
    return {
      report: empty,
      error: 'Phase 42 revenue SLO report contract mismatch',
    };
  }
  return {
    report: {
      ...empty,
      ...report,
      authenticity_snapshots: (report.authenticity_snapshots ?? []).slice(0, 100),
      settlement_snapshots: (report.settlement_snapshots ?? []).slice(0, 50),
      thresholds: {
        authenticity_fail_rate: {
          ...emptyThresholds.authenticity_fail_rate,
          ...(report.thresholds?.authenticity_fail_rate ?? {}),
        },
        settlement_rate: {
          ...emptyThresholds.settlement_rate,
          ...(report.thresholds?.settlement_rate ?? {}),
        },
      },
    },
  };
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Phase 42 SLO ticks require service-role configuration');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function recordPhase42RevenueSloSnapshots(input: {
  entityId: string | null;
  days?: 7 | 30 | 90;
  ledgerProfile?: 'production_v1' | 'sandbox_v1';
}): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  try {
    const sb = serviceClient();
    const { data, error } = await sb.rpc(
      'record_marketing_revenue_phase42_slo_snapshots',
      {
        p_entity_id: input.entityId,
        p_days: input.days ?? 30,
        p_ledger_profile: input.ledgerProfile ?? 'production_v1',
      },
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true, result: data };
  } catch (caught) {
    return {
      ok: false,
      error:
        caught instanceof Error ? caught.message : 'Phase 42 SLO tick failed',
    };
  }
}
