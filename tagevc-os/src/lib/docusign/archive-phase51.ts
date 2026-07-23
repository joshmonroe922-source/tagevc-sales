import { webhookUrl } from '@/lib/shared-services/slo-delivery';
import { createPersistClient } from '@/lib/supabase/persist-client';

export const ARCHIVE_PHASE51_REPORT_VERSION = 'phase51-v1' as const;
const OPS_DESTINATION_KEY = 'ops_alerts';

export type ArchivePhase51AlertKind =
  | 'cadence_rollup_declining'
  | 'third_approver_escalation_raised';

export type ArchivePhase51DeliveryStatus =
  | 'delivered'
  | 'skipped_no_webhook'
  | 'failed'
  | 'recorded'
  | 'none';

export type ArchivePhase51OverallTrend =
  | 'improving'
  | 'stable'
  | 'declining'
  | 'mixed'
  | 'unknown';

export type ArchivePhase51PendingBudgetProposal = {
  proposal_id: string;
  budget_key: string;
  status: string;
  created_at: string;
  distinct_approvers: number;
};

export type ArchivePhase51OpsReport = {
  version: typeof ARCHIVE_PHASE51_REPORT_VERSION | string;
  cadence_rollup_overall_trend: ArchivePhase51OverallTrend | string;
  cadence_rollup_snapshots_compared: number;
  cadence_rollup_min_on_time_rate: number | null;
  cadence_rollup_max_on_time_rate: number | null;
  cadence_rollup_avg_on_time_rate: number | null;
  pending_budget_proposals: ArchivePhase51PendingBudgetProposal[];
  pending_third_approver_escalatable_count: number;
  third_approver_escalations_7d: number;
  alerts: Array<Record<string, unknown>>;
  destination_key: string;
  never_creates_voids_or_resends_envelopes: boolean;
  never_auto_activates: boolean;
};

type CriticalWindow = {
  alert_kind: ArchivePhase51AlertKind | string;
  window_key: string;
  severity?: string;
  proposal_id?: string;
  budget_key?: string;
  distinct_approvers?: number;
  days_since_first_reminder?: number;
  rollup_id?: string;
  metrics_sha256?: string;
};

export function emptyArchivePhase51OpsReport(): ArchivePhase51OpsReport {
  return {
    version: ARCHIVE_PHASE51_REPORT_VERSION,
    cadence_rollup_overall_trend: 'unknown',
    cadence_rollup_snapshots_compared: 0,
    cadence_rollup_min_on_time_rate: null,
    cadence_rollup_max_on_time_rate: null,
    cadence_rollup_avg_on_time_rate: null,
    pending_budget_proposals: [],
    pending_third_approver_escalatable_count: 0,
    third_approver_escalations_7d: 0,
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

function escalationThresholdDays(): number {
  const raw = Number(
    process.env.DOCUSIGN_PHASE51_ESCALATION_THRESHOLD_DAYS ?? 3,
  );
  if (!Number.isFinite(raw)) return 3;
  return Math.min(Math.max(Math.trunc(raw), 1), 30);
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

export async function getArchivePhase51OpsReport(input: {
  firmWide: boolean;
}): Promise<{ report: ArchivePhase51OpsReport; error?: string }> {
  const empty = emptyArchivePhase51OpsReport();
  if (!input.firmWide) {
    return { report: empty };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'get_docusign_archive_phase51_ops_report',
  );
  if (error) return { report: empty, error: error.message };
  const report = data as ArchivePhase51OpsReport | null;
  if (!report || report.version !== ARCHIVE_PHASE51_REPORT_VERSION) {
    return {
      report: empty,
      error: 'Phase 51 archive ops report contract mismatch',
    };
  }
  return {
    report: {
      ...empty,
      ...report,
      pending_budget_proposals: (report.pending_budget_proposals ?? []).slice(
        0,
        25,
      ),
      alerts: (report.alerts ?? []).slice(0, 20),
      destination_key: report.destination_key || OPS_DESTINATION_KEY,
    },
  };
}

export async function runArchivePhase51OpsTick(): Promise<
  | {
      ok: true;
      overallTrend?: string;
      escalationsRaised: number;
      alertsRecorded: number;
      delivered: number;
      skipped: number;
      failed: number;
    }
  | { ok: false; error: string }
> {
  try {
    const sb = await createPersistClient();
    const meta = { contract_version: ARCHIVE_PHASE51_REPORT_VERSION };

    // Read + append-only. Never creates/voids/resends envelopes.
    const { data: rollupData, error: rollupError } = await sb.rpc(
      'record_docusign_cadence_rollup_phase51',
      { p_metadata: meta, p_snapshots: 8 },
    );
    if (rollupError) return { ok: false, error: rollupError.message };
    const rollup = rollupData as { overall_trend?: string } | null;

    const { data: windows, error: windowError } = await sb.rpc(
      'list_docusign_archive_phase51_critical_windows',
      {
        p_window_hours: alertCooldownHours(),
        p_escalation_threshold_days: escalationThresholdDays(),
      },
    );
    if (windowError) return { ok: false, error: windowError.message };

    const pending = ((windows as { pending?: CriticalWindow[] } | null)
      ?.pending ?? []) as CriticalWindow[];
    let alertsRecorded = 0;
    let escalationsRaised = 0;
    let delivered = 0;
    let skipped = 0;
    let failed = 0;

    for (const window of pending.slice(0, 50)) {
      const delivery = await deliverOpsWebhook({
        kind: 'docusign_archive_phase51_ops_alert',
        version: ARCHIVE_PHASE51_REPORT_VERSION,
        alert_kind: window.alert_kind,
        window_key: window.window_key,
        severity: window.severity ?? 'warning',
        destination_key: OPS_DESTINATION_KEY,
        proposal_id: window.proposal_id ?? null,
        metrics_sha256: window.metrics_sha256 ?? null,
      });

      if (window.alert_kind === 'third_approver_escalation_raised') {
        const { data: recorded, error: recordError } = await sb.rpc(
          'record_docusign_third_approver_escalation_phase51',
          {
            p_alert: {
              proposal_id: window.proposal_id ?? null,
              window_key: window.window_key,
              distinct_approvers: window.distinct_approvers ?? 1,
              days_since_first_reminder: window.days_since_first_reminder ?? 0,
              destination_key: OPS_DESTINATION_KEY,
              delivery_status: delivery.delivery_status,
              response_code: delivery.response_code,
              metadata: {
                contract_version: ARCHIVE_PHASE51_REPORT_VERSION,
                budget_key: window.budget_key ?? null,
                never_activates: true,
              },
            },
          },
        );
        if (recordError) return { ok: false, error: recordError.message };
        if ((recorded as { inserted?: boolean } | null)?.inserted) {
          escalationsRaised += 1;
          if (delivery.delivery_status === 'delivered') delivered += 1;
          else if (delivery.delivery_status === 'skipped_no_webhook') skipped += 1;
          else failed += 1;
        }
        continue;
      }

      const { data: recorded, error: recordError } = await sb.rpc(
        'record_docusign_archive_phase51_ops_alert',
        {
          p_alert: {
            alert_kind: window.alert_kind,
            window_key: window.window_key,
            severity: window.severity ?? 'warning',
            destination_key: OPS_DESTINATION_KEY,
            delivery_status: delivery.delivery_status,
            response_code: delivery.response_code,
            metadata: {
              contract_version: ARCHIVE_PHASE51_REPORT_VERSION,
              rollup_id: window.rollup_id ?? null,
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
      overallTrend: rollup?.overall_trend,
      escalationsRaised,
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
          : 'Phase 51 archive ops tick failed',
    };
  }
}
