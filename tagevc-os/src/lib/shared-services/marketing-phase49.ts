import { createClient } from '@supabase/supabase-js';
import {
  REVENUE_REPORT_VERSION_PHASE49,
  type Phase49RevenueOpsReport,
} from '@/lib/shared-services/marketing-revenue-contracts';
import { webhookUrl } from '@/lib/shared-services/slo-delivery';
import { createPersistClient } from '@/lib/supabase/persist-client';

const OPS_DESTINATION_KEY = 'ops_alerts';
const DEFAULT_AUTOPILOT_ACTOR = '00000000-0000-4000-8000-000000000049';

export function emptyPhase49RevenueOpsReport(): Phase49RevenueOpsReport {
  return {
    version: REVENUE_REPORT_VERSION_PHASE49,
    window_days: 30,
    dry_run_health: 'unknown',
    audit_export_health: 'unknown',
    alert_delivery: 'none',
    would_promote_count: 0,
    would_block_count: 0,
    would_wait_count: 0,
    audit_exports_count: 0,
    dry_run_snapshots: [],
    audit_exports: [],
    alerts: [],
    destination_key: OPS_DESTINATION_KEY,
    never_auto_approves_money: true,
  };
}

export async function getPhase49RevenueOpsReport(input: {
  entityId: string | null;
  firmWide: boolean;
  days: 7 | 30 | 90;
}): Promise<{ report: Phase49RevenueOpsReport; error?: string }> {
  const empty = emptyPhase49RevenueOpsReport();
  if (!input.firmWide && !input.entityId) {
    return {
      report: empty,
      error: 'Entity-scoped Phase 49 ops report requires an entity',
    };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'get_marketing_revenue_phase49_ops_report',
    {
      p_entity_id: input.entityId,
      p_days: input.days,
    },
  );
  if (error) return { report: empty, error: error.message };
  const report = data as Phase49RevenueOpsReport | null;
  if (!report || report.version !== REVENUE_REPORT_VERSION_PHASE49) {
    return {
      report: empty,
      error: 'Phase 49 revenue ops report contract mismatch',
    };
  }
  return {
    report: {
      ...empty,
      ...report,
      dry_run_snapshots: (report.dry_run_snapshots ?? []).slice(0, 50),
      audit_exports: (report.audit_exports ?? []).slice(0, 20),
      alerts: (report.alerts ?? []).slice(0, 50),
      destination_key: report.destination_key || OPS_DESTINATION_KEY,
    },
  };
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Phase 49 ops ticks require service-role configuration');
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

function autopilotActorId(): string {
  const raw = process.env.MARKETING_AUTOPILOT_ACTOR_ID?.trim();
  if (raw && /^[0-9a-f-]{36}$/i.test(raw)) return raw;
  return DEFAULT_AUTOPILOT_ACTOR;
}

type CriticalWindow = {
  alert_kind: string;
  entity_id: string | null;
  cohort_id?: string | null;
  window_key: string;
  severity: string;
  metrics_sha256?: string;
  dry_run_id?: string | null;
  export_id?: string | null;
  consecutive_healthy_windows?: number | null;
  windows_required?: number | null;
  promotions_included?: number | null;
  autopilot_runs_included?: number | null;
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

export async function runPhase49RevenueOpsTick(input: {
  entityId: string | null;
  days?: 7 | 30 | 90;
}): Promise<
  | {
      ok: true;
      dryRunSnapshots: number;
      wouldPromoteCount: number;
      wouldBlockCount: number;
      auditExported: boolean;
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

    // Dry run: NEVER calls promote. Read + append-only simulation.
    const { data: dryRunResult, error: dryRunError } = await sb.rpc(
      'record_marketing_autopilot_dry_run_snapshot_phase49',
      {
        p_payload: {
          entity_id: input.entityId,
          actor_id: autopilotActorId(),
          metadata: {
            contract_version: REVENUE_REPORT_VERSION_PHASE49,
            never_auto_approves_money: true,
            never_calls_promote: true,
          },
        },
      },
    );
    if (dryRunError) return { ok: false, error: dryRunError.message };
    const dryRunSnapshots = Number(
      (dryRunResult as { snapshots_recorded?: number } | null)
        ?.snapshots_recorded ?? 0,
    );
    const wouldPromoteCount = Number(
      (dryRunResult as { would_promote_count?: number } | null)
        ?.would_promote_count ?? 0,
    );
    const wouldBlockCount = Number(
      (dryRunResult as { would_block_count?: number } | null)
        ?.would_block_count ?? 0,
    );

    const { data: exportResult, error: exportError } = await sb.rpc(
      'export_marketing_cohort_promotion_audit_phase49',
      {
        p_payload: {
          entity_id: input.entityId,
          window_days: days,
          exported_by: autopilotActorId(),
          metadata: { contract_version: REVENUE_REPORT_VERSION_PHASE49 },
        },
      },
    );
    if (exportError) return { ok: false, error: exportError.message };
    const auditExported =
      (exportResult as { disposition?: string } | null)?.disposition ===
      'exported';

    const { data: windows, error: windowError } = await sb.rpc(
      'list_marketing_revenue_phase49_critical_windows',
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
        kind: 'marketing_revenue_phase49_ops_alert',
        version: REVENUE_REPORT_VERSION_PHASE49,
        alert_kind: window.alert_kind,
        entity_id: window.entity_id,
        cohort_id: window.cohort_id ?? null,
        window_key: window.window_key,
        severity: 'critical',
        destination_key: OPS_DESTINATION_KEY,
        metrics_sha256: window.metrics_sha256 ?? null,
      });

      const { data: recorded, error: recordError } = await sb.rpc(
        'record_marketing_revenue_phase49_ops_alert',
        {
          p_alert: {
            alert_kind: window.alert_kind,
            entity_id: window.entity_id,
            cohort_id: window.cohort_id ?? null,
            window_key: window.window_key,
            destination_key: OPS_DESTINATION_KEY,
            delivery_status: delivery.delivery_status,
            response_code: delivery.response_code,
            metadata: {
              contract_version: REVENUE_REPORT_VERSION_PHASE49,
              dry_run_id: window.dry_run_id ?? null,
              export_id: window.export_id ?? null,
              consecutive_healthy_windows:
                window.consecutive_healthy_windows ?? null,
              windows_required: window.windows_required ?? null,
              promotions_included: window.promotions_included ?? null,
              autopilot_runs_included: window.autopilot_runs_included ?? null,
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
      dryRunSnapshots,
      wouldPromoteCount,
      wouldBlockCount,
      auditExported,
      alertsRecorded,
      delivered,
      skipped,
      failed,
    };
  } catch (caught) {
    return {
      ok: false,
      error:
        caught instanceof Error ? caught.message : 'Phase 49 ops tick failed',
    };
  }
}
