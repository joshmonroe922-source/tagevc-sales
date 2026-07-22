import { createClient } from '@supabase/supabase-js';
import {
  REVENUE_REPORT_VERSION_PHASE45,
  type Phase45RevenueOpsReport,
} from '@/lib/shared-services/marketing-revenue-contracts';
import { webhookUrl } from '@/lib/shared-services/slo-delivery';
import { createPersistClient } from '@/lib/supabase/persist-client';

const OPS_DESTINATION_KEY = 'ops_alerts';

export function emptyPhase45RevenueOpsReport(): Phase45RevenueOpsReport {
  return {
    version: REVENUE_REPORT_VERSION_PHASE45,
    window_days: 30,
    webhook_delivery_health: 'unknown',
    workflow_health: 'unknown',
    alert_delivery: 'none',
    active_rule: null,
    thresholds: {},
    webhook_snapshots: [],
    workflow_snapshots: [],
    rule_versions: [],
    alerts: [],
    destination_key: OPS_DESTINATION_KEY,
  };
}

export async function getPhase45RevenueOpsReport(input: {
  entityId: string | null;
  firmWide: boolean;
  days: 7 | 30 | 90;
}): Promise<{ report: Phase45RevenueOpsReport; error?: string }> {
  const empty = emptyPhase45RevenueOpsReport();
  if (!input.firmWide && !input.entityId) {
    return {
      report: empty,
      error: 'Entity-scoped Phase 45 ops report requires an entity',
    };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'get_marketing_revenue_phase45_ops_report',
    {
      p_entity_id: input.entityId,
      p_days: input.days,
    },
  );
  if (error) return { report: empty, error: error.message };
  const report = data as Phase45RevenueOpsReport | null;
  if (!report || report.version !== REVENUE_REPORT_VERSION_PHASE45) {
    return {
      report: empty,
      error: 'Phase 45 revenue ops report contract mismatch',
    };
  }
  return {
    report: {
      ...empty,
      ...report,
      webhook_snapshots: (report.webhook_snapshots ?? []).slice(0, 100),
      workflow_snapshots: (report.workflow_snapshots ?? []).slice(0, 100),
      rule_versions: (report.rule_versions ?? []).slice(0, 50),
      alerts: (report.alerts ?? []).slice(0, 50),
      destination_key: report.destination_key || OPS_DESTINATION_KEY,
    },
  };
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Phase 45 ops ticks require service-role configuration');
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

type CriticalWindow = {
  alert_kind: string;
  entity_id: string;
  source_id: string | null;
  window_key: string;
  severity: string;
  metrics_sha256?: string;
  snapshot_id?: string;
  success_rate?: number | null;
  delivered_count?: number | null;
  failed_count?: number | null;
  pending_count?: number | null;
  oldest_pending_hours?: number | null;
  validated_failed?: number | null;
  auto_rejected?: number | null;
  pass_rate?: number | null;
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

export async function runPhase45RevenueOpsTick(input: {
  entityId: string | null;
  days?: 7 | 30 | 90;
}): Promise<
  | {
      ok: true;
      webhookSnapshots: number;
      workflowSnapshots: number;
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

    const { data: webhookResult, error: webhookError } = await sb.rpc(
      'record_marketing_revenue_webhook_delivery_slo_phase45',
      {
        p_entity_id: input.entityId,
        p_days: days,
      },
    );
    if (webhookError) return { ok: false, error: webhookError.message };
    const webhookSnapshots = Number(
      (webhookResult as { snapshots_recorded?: number } | null)
        ?.snapshots_recorded ?? 0,
    );

    const { data: workflowResult, error: workflowError } = await sb.rpc(
      'record_marketing_revenue_correction_workflow_snapshot_phase45',
      {
        p_entity_id: input.entityId,
        p_days: days,
      },
    );
    if (workflowError) return { ok: false, error: workflowError.message };
    const workflowSnapshots = Number(
      (workflowResult as { snapshots_recorded?: number } | null)
        ?.snapshots_recorded ?? 0,
    );

    const { data: windows, error: windowError } = await sb.rpc(
      'list_marketing_revenue_phase45_critical_windows',
      {
        p_entity_id: input.entityId,
        p_days: days,
        p_window_hours: alertCooldownHours(),
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
        kind: 'marketing_revenue_phase45_ops_alert',
        version: REVENUE_REPORT_VERSION_PHASE45,
        alert_kind: window.alert_kind,
        entity_id: window.entity_id,
        source_id: window.source_id,
        window_key: window.window_key,
        severity: 'critical',
        destination_key: OPS_DESTINATION_KEY,
        metrics_sha256: window.metrics_sha256 ?? null,
      });

      const { data: recorded, error: recordError } = await sb.rpc(
        'record_marketing_revenue_phase45_ops_alert',
        {
          p_alert: {
            alert_kind: window.alert_kind,
            entity_id: window.entity_id,
            source_id: window.source_id,
            window_key: window.window_key,
            destination_key: OPS_DESTINATION_KEY,
            delivery_status: delivery.delivery_status,
            response_code: delivery.response_code,
            metadata: {
              contract_version: REVENUE_REPORT_VERSION_PHASE45,
              snapshot_id: window.snapshot_id ?? null,
              success_rate: window.success_rate ?? null,
              delivered_count: window.delivered_count ?? null,
              failed_count: window.failed_count ?? null,
              pending_count: window.pending_count ?? null,
              oldest_pending_hours: window.oldest_pending_hours ?? null,
              validated_failed: window.validated_failed ?? null,
              auto_rejected: window.auto_rejected ?? null,
              pass_rate: window.pass_rate ?? null,
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
      webhookSnapshots,
      workflowSnapshots,
      alertsRecorded,
      delivered,
      skipped,
      failed,
    };
  } catch (caught) {
    return {
      ok: false,
      error:
        caught instanceof Error ? caught.message : 'Phase 45 ops tick failed',
    };
  }
}
