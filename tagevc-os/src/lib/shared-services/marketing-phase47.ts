import { createClient } from '@supabase/supabase-js';
import {
  REVENUE_REPORT_VERSION_PHASE47,
  type Phase47RevenueOpsReport,
} from '@/lib/shared-services/marketing-revenue-contracts';
import { webhookUrl } from '@/lib/shared-services/slo-delivery';
import { createPersistClient } from '@/lib/supabase/persist-client';

const OPS_DESTINATION_KEY = 'ops_alerts';

export function emptyPhase47RevenueOpsReport(): Phase47RevenueOpsReport {
  return {
    version: REVENUE_REPORT_VERSION_PHASE47,
    window_days: 30,
    cohort_gate_health: 'unknown',
    conflict_aging_health: 'unknown',
    closure_health: 'unknown',
    alert_delivery: 'none',
    open_aging_count: 0,
    pending_closure_count: 0,
    cohort_gate: null,
    thresholds: {},
    cohorts: [],
    cohort_promotions: [],
    conflict_closures: [],
    aging_conflicts: [],
    alerts: [],
    destination_key: OPS_DESTINATION_KEY,
  };
}

export async function getPhase47RevenueOpsReport(input: {
  entityId: string | null;
  firmWide: boolean;
  days: 7 | 30 | 90;
}): Promise<{ report: Phase47RevenueOpsReport; error?: string }> {
  const empty = emptyPhase47RevenueOpsReport();
  if (!input.firmWide && !input.entityId) {
    return {
      report: empty,
      error: 'Entity-scoped Phase 47 ops report requires an entity',
    };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'get_marketing_revenue_phase47_ops_report',
    {
      p_entity_id: input.entityId,
      p_days: input.days,
    },
  );
  if (error) return { report: empty, error: error.message };
  const report = data as Phase47RevenueOpsReport | null;
  if (!report || report.version !== REVENUE_REPORT_VERSION_PHASE47) {
    return {
      report: empty,
      error: 'Phase 47 revenue ops report contract mismatch',
    };
  }
  return {
    report: {
      ...empty,
      ...report,
      cohorts: (report.cohorts ?? []).slice(0, 50),
      cohort_promotions: (report.cohort_promotions ?? []).slice(0, 50),
      conflict_closures: (report.conflict_closures ?? []).slice(0, 50),
      aging_conflicts: (report.aging_conflicts ?? []).slice(0, 50),
      alerts: (report.alerts ?? []).slice(0, 50),
      destination_key: report.destination_key || OPS_DESTINATION_KEY,
    },
  };
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Phase 47 ops ticks require service-role configuration');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function alertCooldownHours(): number {
  const raw = Number(process.env.MARKETING_SLO_ALERT_COOLDOWN_HOURS ?? 24);
  if (!Number.isFinite(raw)) return 24;
  return Math.min(Math.max(Math.trunc(raw), 1), 168);
}

function conflictAgingDays(): number {
  const raw = Number(process.env.MARKETING_CONFLICT_AGING_DAYS ?? 7);
  if (!Number.isFinite(raw)) return 7;
  return Math.min(Math.max(Math.trunc(raw), 1), 90);
}

type CriticalWindow = {
  alert_kind: string;
  entity_id: string;
  source_id: string | null;
  cohort_id?: string | null;
  conflict_id?: string | null;
  window_key: string;
  severity: string;
  metrics_sha256?: string;
  age_days?: number | null;
  age_hours?: number | null;
  conflict_kind?: string | null;
  resolution_status?: string | null;
  closure_id?: string | null;
  closure_status?: string | null;
};

async function deliverOpsWebhook(payload: Record<string, unknown>): Promise<{
  delivery_status: 'delivered' | 'skipped_no_webhook' | 'failed';
  response_code: number | null;
}> {
  const url = webhookUrl(OPS_DESTINATION_KEY);
  if (!url) {
    return { delivery_status: 'skipped_no_webhook', response_code: null };
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      redirect: 'error',
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return { delivery_status: 'failed', response_code: response.status };
    }
    return { delivery_status: 'delivered', response_code: response.status };
  } catch {
    return { delivery_status: 'failed', response_code: null };
  }
}

export async function runPhase47RevenueOpsTick(input: {
  entityId: string | null;
  days?: 7 | 30 | 90;
}): Promise<
  | {
      ok: true;
      agingDetected: number;
      alertsRecorded: number;
      delivered: number;
      skipped: number;
      failed: number;
    }
  | { ok: false; error: string }
> {
  try {
    const sb = serviceClient();
    const days = input.days ?? 30;
    const agingDays = conflictAgingDays();

    const { data: detectResult, error: detectError } = await sb.rpc(
      'detect_marketing_attribution_conflicts_aging_phase47',
      {
        p_entity_id: input.entityId,
        p_days: days,
        p_aging_days: agingDays,
      },
    );
    if (detectError) return { ok: false, error: detectError.message };
    const agingDetected = Number(
      (
        detectResult as {
          aging?: { conflicts?: unknown[] };
          detect?: { conflicts_inserted?: number };
        } | null
      )?.aging?.conflicts?.length ?? 0,
    );

    const { data: windows, error: windowError } = await sb.rpc(
      'list_marketing_revenue_phase47_critical_windows',
      {
        p_entity_id: input.entityId,
        p_days: days,
        p_window_hours: alertCooldownHours(),
        p_aging_days: agingDays,
      },
    );
    if (windowError) return { ok: false, error: windowError.message };

    const pending = ((windows as { pending?: CriticalWindow[] } | null)
      ?.pending ?? []) as CriticalWindow[];
    let alertsRecorded = 0;
    let delivered = 0;
    let skipped = 0;
    let failed = 0;

    for (const window of pending.slice(0, 50)) {
      const delivery = await deliverOpsWebhook({
        kind: 'marketing_revenue_phase47_ops_alert',
        version: REVENUE_REPORT_VERSION_PHASE47,
        alert_kind: window.alert_kind,
        entity_id: window.entity_id,
        source_id: window.source_id,
        cohort_id: window.cohort_id ?? null,
        conflict_id: window.conflict_id ?? null,
        window_key: window.window_key,
        severity: 'critical',
        destination_key: OPS_DESTINATION_KEY,
        metrics_sha256: window.metrics_sha256 ?? null,
      });

      const { data: recorded, error: recordError } = await sb.rpc(
        'record_marketing_revenue_phase47_ops_alert',
        {
          p_alert: {
            alert_kind: window.alert_kind,
            entity_id: window.entity_id,
            source_id: window.source_id,
            cohort_id: window.cohort_id ?? null,
            conflict_id: window.conflict_id ?? null,
            window_key: window.window_key,
            destination_key: OPS_DESTINATION_KEY,
            delivery_status: delivery.delivery_status,
            response_code: delivery.response_code,
            metadata: {
              contract_version: REVENUE_REPORT_VERSION_PHASE47,
              age_days: window.age_days ?? null,
              age_hours: window.age_hours ?? null,
              conflict_kind: window.conflict_kind ?? null,
              resolution_status: window.resolution_status ?? null,
              closure_id: window.closure_id ?? null,
              closure_status: window.closure_status ?? null,
            },
          },
        },
      );
      if (recordError) return { ok: false, error: recordError.message };
      if ((recorded as { inserted?: boolean } | null)?.inserted) {
        alertsRecorded += 1;
        if (delivery.delivery_status === 'delivered') delivered += 1;
        else if (delivery.delivery_status === 'skipped_no_webhook') skipped += 1;
        else failed += 1;
      }
    }

    return {
      ok: true,
      agingDetected,
      alertsRecorded,
      delivered,
      skipped,
      failed,
    };
  } catch (caught) {
    return {
      ok: false,
      error:
        caught instanceof Error ? caught.message : 'Phase 47 ops tick failed',
    };
  }
}
