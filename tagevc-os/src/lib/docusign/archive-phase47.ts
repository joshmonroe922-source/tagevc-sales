import { webhookUrl } from '@/lib/shared-services/slo-delivery';
import { createPersistClient } from '@/lib/supabase/persist-client';

export const ARCHIVE_PHASE47_REPORT_VERSION = 'phase47-v1' as const;
const OPS_DESTINATION_KEY = 'ops_alerts';

export type ArchivePhase47AlertKind =
  | 'recurring_run_blocked'
  | 'drift_budget_breach_during_quarterly'
  | 'first_recurring_completed'
  | 'cadence_report_ready';

export type ArchivePhase47DeliveryStatus =
  | 'delivered'
  | 'skipped_no_webhook'
  | 'failed'
  | 'recorded'
  | 'none';

export type ArchivePhase47RecurringRunStatus =
  | 'none'
  | 'started'
  | 'completed'
  | 'blocked'
  | 'drift_budget_breach';

export type ArchivePhase47DriftPerformance =
  | 'unknown'
  | 'within_budget'
  | 'breach';

export type ArchivePhase47OpsReport = {
  version: typeof ARCHIVE_PHASE47_REPORT_VERSION | string;
  recurring_run_status: ArchivePhase47RecurringRunStatus | string;
  drift_performance: ArchivePhase47DriftPerformance | string;
  alert_delivery: ArchivePhase47DeliveryStatus;
  critical_alert_count: number;
  first_recurring_completed: boolean;
  recurring_quarterly_armed: boolean;
  tightened_budget_active: boolean;
  latest_run: Record<string, unknown> | null;
  latest_report: Record<string, unknown> | null;
  latest_arm: Record<string, unknown> | null;
  latest_revision: Record<string, unknown> | null;
  alerts: Array<Record<string, unknown>>;
  destination_key: string;
};

type CriticalWindow = {
  alert_kind: ArchivePhase47AlertKind | string;
  window_key: string;
  severity?: string;
  metrics_sha256?: string;
  run_id?: string;
  arm_id?: string;
  campaign_id?: string;
  report_id?: string;
  block_reason?: string;
  content_drift_count?: number;
  storage_unavailable_count?: number;
  max_content_drift_per_window?: number;
  max_storage_unavailable?: number;
  within_budget?: boolean;
  recurring_run_status?: string;
  drift_performance?: string;
};

export function emptyArchivePhase47OpsReport(): ArchivePhase47OpsReport {
  return {
    version: ARCHIVE_PHASE47_REPORT_VERSION,
    recurring_run_status: 'none',
    drift_performance: 'unknown',
    alert_delivery: 'none',
    critical_alert_count: 0,
    first_recurring_completed: false,
    recurring_quarterly_armed: false,
    tightened_budget_active: false,
    latest_run: null,
    latest_report: null,
    latest_arm: null,
    latest_revision: null,
    alerts: [],
    destination_key: OPS_DESTINATION_KEY,
  };
}

function alertCooldownHours(): number {
  const raw = Number(
    process.env.DOCUSIGN_ARCHIVE_ALERT_COOLDOWN_HOURS ??
      process.env.MARKETING_SLO_ALERT_COOLDOWN_HOURS ??
      24,
  );
  if (!Number.isFinite(raw)) return 24;
  return Math.min(Math.max(Math.trunc(raw), 1), 168);
}

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

export async function getArchivePhase47OpsReport(input: {
  firmWide: boolean;
}): Promise<{ report: ArchivePhase47OpsReport; error?: string }> {
  const empty = emptyArchivePhase47OpsReport();
  if (!input.firmWide) {
    return { report: empty };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'get_docusign_archive_phase47_ops_report',
  );
  if (error) return { report: empty, error: error.message };
  const report = data as ArchivePhase47OpsReport | null;
  if (!report || report.version !== ARCHIVE_PHASE47_REPORT_VERSION) {
    return {
      report: empty,
      error: 'Phase 47 archive ops report contract mismatch',
    };
  }
  return {
    report: {
      ...empty,
      ...report,
      alerts: (report.alerts ?? []).slice(0, 20),
      destination_key: report.destination_key || OPS_DESTINATION_KEY,
    },
  };
}

export async function runArchivePhase47OpsTick(): Promise<
  | {
      ok: true;
      runId?: string;
      runStatus?: string;
      reportId?: string;
      driftPerformance?: string;
      alertsRecorded: number;
      delivered: number;
      skipped: number;
      failed: number;
    }
  | { ok: false; error: string }
> {
  try {
    const sb = await createPersistClient();
    const meta = { contract_version: ARCHIVE_PHASE47_REPORT_VERSION };

    const { data: runData, error: runError } = await sb.rpc(
      'run_docusign_first_armed_recurring_quarterly_phase47',
      {
        p_metadata: meta,
        p_force: true,
      },
    );
    if (runError) return { ok: false, error: runError.message };
    const run = runData as {
      run_id?: string;
      status?: string;
      disposition?: string;
      within_budget?: boolean;
    } | null;

    const { data: reportData, error: reportError } = await sb.rpc(
      'record_docusign_recurring_quarterly_report_phase47',
      { p_metadata: meta },
    );
    if (reportError) return { ok: false, error: reportError.message };
    const report = reportData as {
      report_id?: string;
      drift_performance?: string;
      recurring_run_status?: string;
    } | null;

    const { data: windows, error: windowError } = await sb.rpc(
      'list_docusign_archive_phase47_critical_windows',
      { p_window_hours: alertCooldownHours() },
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
        kind: 'docusign_archive_phase47_ops_alert',
        version: ARCHIVE_PHASE47_REPORT_VERSION,
        alert_kind: window.alert_kind,
        window_key: window.window_key,
        severity: 'critical',
        destination_key: OPS_DESTINATION_KEY,
        metrics_sha256: window.metrics_sha256 ?? null,
      });

      const { data: recorded, error: recordError } = await sb.rpc(
        'record_docusign_archive_phase47_ops_alert',
        {
          p_alert: {
            alert_kind: window.alert_kind,
            window_key: window.window_key,
            destination_key: OPS_DESTINATION_KEY,
            delivery_status: delivery.delivery_status,
            response_code: delivery.response_code,
            metadata: {
              contract_version: ARCHIVE_PHASE47_REPORT_VERSION,
              run_id: window.run_id ?? null,
              arm_id: window.arm_id ?? null,
              campaign_id: window.campaign_id ?? null,
              report_id: window.report_id ?? null,
              block_reason: window.block_reason ?? null,
              content_drift_count: window.content_drift_count ?? null,
              storage_unavailable_count:
                window.storage_unavailable_count ?? null,
              within_budget: window.within_budget ?? null,
              recurring_run_status: window.recurring_run_status ?? null,
              drift_performance: window.drift_performance ?? null,
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
      runId: run?.run_id,
      runStatus: run?.status,
      reportId: report?.report_id,
      driftPerformance: report?.drift_performance,
      alertsRecorded,
      delivered,
      skipped,
      failed,
    };
  } catch (caught) {
    return {
      ok: false,
      error:
        caught instanceof Error
          ? caught.message
          : 'Phase 47 archive ops tick failed',
    };
  }
}
