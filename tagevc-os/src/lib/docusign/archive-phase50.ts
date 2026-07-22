import { webhookUrl } from '@/lib/shared-services/slo-delivery';
import { createPersistClient } from '@/lib/supabase/persist-client';

export const ARCHIVE_PHASE50_REPORT_VERSION = 'phase50-v1' as const;
const OPS_DESTINATION_KEY = 'ops_alerts';

export type ArchivePhase50AlertKind =
  | 'cadence_trend_declining'
  | 'budget_revision_second_approver_reminder'
  | 'recurring_process_health_critical';

export type ArchivePhase50DeliveryStatus =
  | 'delivered'
  | 'skipped_no_webhook'
  | 'failed'
  | 'recorded'
  | 'none';

export type ArchivePhase50TrendDirection =
  | 'improving'
  | 'stable'
  | 'declining'
  | 'unknown';

export type ArchivePhase50ProcessHealth =
  | 'unknown'
  | 'healthy'
  | 'warning'
  | 'critical';

export type ArchivePhase50OpsReport = {
  version: typeof ARCHIVE_PHASE50_REPORT_VERSION | string;
  cadence_trend_direction: ArchivePhase50TrendDirection | string;
  cadence_consecutive_healthy_snapshots: number;
  recurring_process_health: ArchivePhase50ProcessHealth | string;
  recurring_quarters_tracked: number;
  pending_second_approver_reminder_count: number;
  reminders_sent_7d: number;
  alert_delivery: ArchivePhase50DeliveryStatus;
  latest_cadence_trend: Record<string, unknown> | null;
  latest_recurring_visibility: Record<string, unknown> | null;
  alerts: Array<Record<string, unknown>>;
  destination_key: string;
  never_creates_voids_or_resends_envelopes: boolean;
  never_auto_activates: boolean;
};

type CriticalWindow = {
  alert_kind: ArchivePhase50AlertKind | string;
  window_key: string;
  severity?: string;
  proposal_id?: string;
  budget_key?: string;
  distinct_approvers?: number;
  trend_id?: string;
  snapshot_id?: string;
  metrics_sha256?: string;
};

export function emptyArchivePhase50OpsReport(): ArchivePhase50OpsReport {
  return {
    version: ARCHIVE_PHASE50_REPORT_VERSION,
    cadence_trend_direction: 'unknown',
    cadence_consecutive_healthy_snapshots: 0,
    recurring_process_health: 'unknown',
    recurring_quarters_tracked: 0,
    pending_second_approver_reminder_count: 0,
    reminders_sent_7d: 0,
    alert_delivery: 'none',
    latest_cadence_trend: null,
    latest_recurring_visibility: null,
    alerts: [],
    destination_key: OPS_DESTINATION_KEY,
    never_creates_voids_or_resends_envelopes: true,
    never_auto_activates: true,
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

export async function getArchivePhase50OpsReport(input: {
  firmWide: boolean;
}): Promise<{ report: ArchivePhase50OpsReport; error?: string }> {
  const empty = emptyArchivePhase50OpsReport();
  if (!input.firmWide) {
    return { report: empty };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'get_docusign_archive_phase50_ops_report',
  );
  if (error) return { report: empty, error: error.message };
  const report = data as ArchivePhase50OpsReport | null;
  if (!report || report.version !== ARCHIVE_PHASE50_REPORT_VERSION) {
    return {
      report: empty,
      error: 'Phase 50 archive ops report contract mismatch',
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

export async function runArchivePhase50OpsTick(): Promise<
  | {
      ok: true;
      trendDirection?: string;
      recurringProcessHealth?: string;
      remindersSent: number;
      alertsRecorded: number;
      delivered: number;
      skipped: number;
      failed: number;
    }
  | { ok: false; error: string }
> {
  try {
    const sb = await createPersistClient();
    const meta = { contract_version: ARCHIVE_PHASE50_REPORT_VERSION };

    // Read + append-only. Never creates/voids/resends envelopes.
    const { data: trendData, error: trendError } = await sb.rpc(
      'record_docusign_cadence_trend_snapshot_phase50',
      { p_metadata: meta, p_windows: 4 },
    );
    if (trendError) return { ok: false, error: trendError.message };
    const trend = trendData as { trend_direction?: string } | null;

    const { data: recurData, error: recurError } = await sb.rpc(
      'record_docusign_recurring_visibility_snapshot_phase50',
      { p_metadata: meta },
    );
    if (recurError) return { ok: false, error: recurError.message };
    const recur = recurData as { process_health?: string } | null;

    const { data: windows, error: windowError } = await sb.rpc(
      'list_docusign_archive_phase50_critical_windows',
      { p_window_hours: alertCooldownHours() },
    );
    if (windowError) return { ok: false, error: windowError.message };

    const pending = ((windows as { pending?: CriticalWindow[] } | null)
      ?.pending ?? []) as CriticalWindow[];
    let alertsRecorded = 0;
    let remindersSent = 0;
    let delivered = 0;
    let skipped = 0;
    let failed = 0;

    for (const window of pending.slice(0, 50)) {
      const delivery = await deliverOpsWebhook({
        kind: 'docusign_archive_phase50_ops_alert',
        version: ARCHIVE_PHASE50_REPORT_VERSION,
        alert_kind: window.alert_kind,
        window_key: window.window_key,
        severity: window.severity ?? 'warning',
        destination_key: OPS_DESTINATION_KEY,
        proposal_id: window.proposal_id ?? null,
        metrics_sha256: window.metrics_sha256 ?? null,
      });

      if (window.alert_kind === 'budget_revision_second_approver_reminder') {
        const { data: recorded, error: recordError } = await sb.rpc(
          'record_docusign_second_approver_reminder_phase50',
          {
            p_alert: {
              proposal_id: window.proposal_id ?? null,
              window_key: window.window_key,
              distinct_approvers: window.distinct_approvers ?? 1,
              destination_key: OPS_DESTINATION_KEY,
              delivery_status: delivery.delivery_status,
              response_code: delivery.response_code,
              metadata: {
                contract_version: ARCHIVE_PHASE50_REPORT_VERSION,
                budget_key: window.budget_key ?? null,
                never_activates: true,
              },
            },
          },
        );
        if (recordError) return { ok: false, error: recordError.message };
        if ((recorded as { inserted?: boolean } | null)?.inserted) {
          remindersSent += 1;
          if (delivery.delivery_status === 'delivered') delivered += 1;
          else if (delivery.delivery_status === 'skipped_no_webhook') skipped += 1;
          else failed += 1;
        }
        continue;
      }

      const { data: recorded, error: recordError } = await sb.rpc(
        'record_docusign_archive_phase50_ops_alert',
        {
          p_alert: {
            alert_kind: window.alert_kind,
            window_key: window.window_key,
            severity: window.severity ?? 'warning',
            destination_key: OPS_DESTINATION_KEY,
            delivery_status: delivery.delivery_status,
            response_code: delivery.response_code,
            metadata: {
              contract_version: ARCHIVE_PHASE50_REPORT_VERSION,
              trend_id: window.trend_id ?? null,
              snapshot_id: window.snapshot_id ?? null,
              metrics_sha256: window.metrics_sha256 ?? null,
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
      trendDirection: trend?.trend_direction,
      recurringProcessHealth: recur?.process_health,
      remindersSent,
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
          : 'Phase 50 archive ops tick failed',
    };
  }
}
