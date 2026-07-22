import { webhookUrl } from '@/lib/shared-services/slo-delivery';
import { createPersistClient } from '@/lib/supabase/persist-client';

export const ARCHIVE_PHASE48_REPORT_VERSION = 'phase48-v1' as const;
const OPS_DESTINATION_KEY = 'ops_alerts';

export type ArchivePhase48AlertKind =
  | 'subsequent_run_blocked'
  | 'drift_budget_breach'
  | 'drift_budget_tightened_on_breach'
  | 'subsequent_run_completed'
  | 'schedule_due'
  | 'performance_report_ready';

export type ArchivePhase48DeliveryStatus =
  | 'delivered'
  | 'skipped_no_webhook'
  | 'failed'
  | 'recorded'
  | 'none';

export type ArchivePhase48ScheduleStatus =
  | 'none'
  | 'scheduled'
  | 'due'
  | 'completed'
  | 'blocked';

export type ArchivePhase48SubsequentRunStatus =
  | 'none'
  | 'started'
  | 'completed'
  | 'blocked'
  | 'drift_budget_breach';

export type ArchivePhase48DriftPerformance =
  | 'unknown'
  | 'within_budget'
  | 'breach';

export type ArchivePhase48BreachTightenStatus =
  | 'none'
  | 'proposed'
  | 'activated'
  | 'blocked'
  | 'unchanged';

export type ArchivePhase48OpsReport = {
  version: typeof ARCHIVE_PHASE48_REPORT_VERSION | string;
  schedule_status: ArchivePhase48ScheduleStatus | string;
  subsequent_run_status: ArchivePhase48SubsequentRunStatus | string;
  drift_performance: ArchivePhase48DriftPerformance | string;
  breach_tighten_status: ArchivePhase48BreachTightenStatus | string;
  alert_delivery: ArchivePhase48DeliveryStatus;
  critical_alert_count: number;
  completed_subsequent_count: number;
  breach_count_30d: number;
  recurring_quarterly_armed: boolean;
  latest_schedule: Record<string, unknown> | null;
  latest_subsequent_run: Record<string, unknown> | null;
  latest_performance_report: Record<string, unknown> | null;
  latest_breach_tighten: Record<string, unknown> | null;
  alerts: Array<Record<string, unknown>>;
  destination_key: string;
};

type CriticalWindow = {
  alert_kind: ArchivePhase48AlertKind | string;
  window_key: string;
  severity?: string;
  metrics_sha256?: string;
  run_id?: string;
  schedule_id?: string;
  arm_id?: string;
  campaign_id?: string;
  report_id?: string;
  event_id?: string;
  revision_id?: string;
  budget_key?: string;
  block_reason?: string;
  content_drift_count?: number;
  storage_unavailable_count?: number;
  max_content_drift_per_window?: number;
  max_storage_unavailable?: number;
  within_budget?: boolean;
  schedule_status?: string;
  subsequent_run_status?: string;
  drift_performance?: string;
  status?: string;
  due_at?: string;
  subsequent_run_id?: string;
};

export function emptyArchivePhase48OpsReport(): ArchivePhase48OpsReport {
  return {
    version: ARCHIVE_PHASE48_REPORT_VERSION,
    schedule_status: 'none',
    subsequent_run_status: 'none',
    drift_performance: 'unknown',
    breach_tighten_status: 'none',
    alert_delivery: 'none',
    critical_alert_count: 0,
    completed_subsequent_count: 0,
    breach_count_30d: 0,
    recurring_quarterly_armed: false,
    latest_schedule: null,
    latest_subsequent_run: null,
    latest_performance_report: null,
    latest_breach_tighten: null,
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

export async function getArchivePhase48OpsReport(input: {
  firmWide: boolean;
}): Promise<{ report: ArchivePhase48OpsReport; error?: string }> {
  const empty = emptyArchivePhase48OpsReport();
  if (!input.firmWide) {
    return { report: empty };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'get_docusign_archive_phase48_ops_report',
  );
  if (error) return { report: empty, error: error.message };
  const report = data as ArchivePhase48OpsReport | null;
  if (!report || report.version !== ARCHIVE_PHASE48_REPORT_VERSION) {
    return {
      report: empty,
      error: 'Phase 48 archive ops report contract mismatch',
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

export async function runArchivePhase48OpsTick(): Promise<
  | {
      ok: true;
      scheduleId?: string;
      scheduleStatus?: string;
      runId?: string;
      runStatus?: string;
      reportId?: string;
      driftPerformance?: string;
      breachTightenStatus?: string;
      alertsRecorded: number;
      delivered: number;
      skipped: number;
      failed: number;
    }
  | { ok: false; error: string }
> {
  try {
    const sb = await createPersistClient();
    const meta = { contract_version: ARCHIVE_PHASE48_REPORT_VERSION };

    const { data: scheduleData, error: scheduleError } = await sb.rpc(
      'schedule_docusign_subsequent_recurring_quarterly_phase48',
      {
        p_metadata: meta,
        p_force_due: false,
      },
    );
    if (scheduleError) return { ok: false, error: scheduleError.message };
    const schedule = scheduleData as {
      schedule_id?: string;
      status?: string;
      disposition?: string;
    } | null;

    const { data: runData, error: runError } = await sb.rpc(
      'run_docusign_subsequent_recurring_quarterly_phase48',
      {
        p_metadata: meta,
        p_force: false,
      },
    );
    if (runError) return { ok: false, error: runError.message };
    const run = runData as {
      run_id?: string;
      status?: string;
      disposition?: string;
    } | null;

    const { data: tightenData, error: tightenError } = await sb.rpc(
      'tighten_docusign_drift_budget_on_breach_phase48',
      {
        p_metadata: meta,
        p_lookback_days: 30,
      },
    );
    if (tightenError) return { ok: false, error: tightenError.message };
    const tighten = tightenData as {
      status?: string;
      disposition?: string;
    } | null;

    const { data: reportData, error: reportError } = await sb.rpc(
      'record_docusign_recurring_performance_report_phase48',
      { p_metadata: meta },
    );
    if (reportError) return { ok: false, error: reportError.message };
    const report = reportData as {
      report_id?: string;
      drift_performance?: string;
      subsequent_run_status?: string;
    } | null;

    const { data: windows, error: windowError } = await sb.rpc(
      'list_docusign_archive_phase48_critical_windows',
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
        kind: 'docusign_archive_phase48_ops_alert',
        version: ARCHIVE_PHASE48_REPORT_VERSION,
        alert_kind: window.alert_kind,
        window_key: window.window_key,
        severity: 'critical',
        destination_key: OPS_DESTINATION_KEY,
        metrics_sha256: window.metrics_sha256 ?? null,
      });

      const { data: recorded, error: recordError } = await sb.rpc(
        'record_docusign_archive_phase48_ops_alert',
        {
          p_alert: {
            alert_kind: window.alert_kind,
            window_key: window.window_key,
            destination_key: OPS_DESTINATION_KEY,
            delivery_status: delivery.delivery_status,
            response_code: delivery.response_code,
            metadata: {
              contract_version: ARCHIVE_PHASE48_REPORT_VERSION,
              run_id: window.run_id ?? null,
              schedule_id: window.schedule_id ?? null,
              arm_id: window.arm_id ?? null,
              campaign_id: window.campaign_id ?? null,
              report_id: window.report_id ?? null,
              event_id: window.event_id ?? null,
              revision_id: window.revision_id ?? null,
              budget_key: window.budget_key ?? null,
              block_reason: window.block_reason ?? null,
              content_drift_count: window.content_drift_count ?? null,
              storage_unavailable_count:
                window.storage_unavailable_count ?? null,
              within_budget: window.within_budget ?? null,
              schedule_status: window.schedule_status ?? null,
              subsequent_run_status: window.subsequent_run_status ?? null,
              drift_performance: window.drift_performance ?? null,
              status: window.status ?? null,
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
      scheduleId: schedule?.schedule_id,
      scheduleStatus: schedule?.status,
      runId: run?.run_id,
      runStatus: run?.status,
      reportId: report?.report_id,
      driftPerformance: report?.drift_performance,
      breachTightenStatus: tighten?.status,
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
          : 'Phase 48 archive ops tick failed',
    };
  }
}
