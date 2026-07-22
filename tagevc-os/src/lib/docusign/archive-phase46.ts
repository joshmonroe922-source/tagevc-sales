import { webhookUrl } from '@/lib/shared-services/slo-delivery';
import { createPersistClient } from '@/lib/supabase/persist-client';

export const ARCHIVE_PHASE46_REPORT_VERSION = 'phase46-v1' as const;
const OPS_DESTINATION_KEY = 'ops_alerts';
const DEFAULT_BUDGET_KEY = 'firm_signed_archives';

export type ArchivePhase46AlertKind =
  | 'first_quarterly_incomplete'
  | 'recurring_unarmed'
  | 'drift_budget_tighten_due'
  | 'cadence_unhealthy';

export type ArchivePhase46DeliveryStatus =
  | 'delivered'
  | 'skipped_no_webhook'
  | 'failed'
  | 'recorded'
  | 'none';

export type ArchivePhase46Health = 'healthy' | 'watch' | 'critical' | 'unknown';

export type ArchivePhase46FirstQuarterlyStatus =
  | 'incomplete'
  | 'blocked'
  | 'completed';

export type ArchivePhase46RecurringStatus = 'unarmed' | 'armed';

export type ArchivePhase46DriftRevisionStatus =
  | 'none'
  | 'proposed'
  | 'activated';

export type ArchivePhase46OpsReport = {
  version: typeof ARCHIVE_PHASE46_REPORT_VERSION | string;
  first_quarterly_status: ArchivePhase46FirstQuarterlyStatus | string;
  recurring_quarterly_status: ArchivePhase46RecurringStatus | string;
  drift_revision_status: ArchivePhase46DriftRevisionStatus | string;
  cadence_health: ArchivePhase46Health;
  alert_delivery: ArchivePhase46DeliveryStatus;
  critical_alert_count: number;
  first_quarterly_completed: boolean;
  recurring_quarterly_armed: boolean;
  latest_completion: Record<string, unknown> | null;
  latest_arm: Record<string, unknown> | null;
  latest_revision: Record<string, unknown> | null;
  latest_cadence: Record<string, unknown> | null;
  alerts: Array<Record<string, unknown>>;
  destination_key: string;
};

type CriticalWindow = {
  alert_kind: ArchivePhase46AlertKind | string;
  window_key: string;
  severity?: string;
  metrics_sha256?: string;
  completion_id?: string;
  budget_id?: string;
  baseline_snapshot_id?: string;
  ops_id?: string;
  health?: string;
  sample_overdue?: boolean;
  full_overdue?: boolean;
  quarterly_overdue?: boolean;
  last_sample_at?: string | null;
  last_full_at?: string | null;
  last_quarterly_at?: string | null;
  next_quarterly_due?: string | null;
  max_content_drift_per_window?: number;
  max_storage_unavailable?: number;
  baseline_content_drift_count?: number;
  baseline_storage_unavailable_count?: number;
};

export function emptyArchivePhase46OpsReport(): ArchivePhase46OpsReport {
  return {
    version: ARCHIVE_PHASE46_REPORT_VERSION,
    first_quarterly_status: 'incomplete',
    recurring_quarterly_status: 'unarmed',
    drift_revision_status: 'none',
    cadence_health: 'unknown',
    alert_delivery: 'none',
    critical_alert_count: 0,
    first_quarterly_completed: false,
    recurring_quarterly_armed: false,
    latest_completion: null,
    latest_arm: null,
    latest_revision: null,
    latest_cadence: null,
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

export async function getArchivePhase46OpsReport(input: {
  firmWide: boolean;
}): Promise<{ report: ArchivePhase46OpsReport; error?: string }> {
  const empty = emptyArchivePhase46OpsReport();
  if (!input.firmWide) {
    return { report: empty };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'get_docusign_archive_phase46_ops_report',
  );
  if (error) return { report: empty, error: error.message };
  const report = data as ArchivePhase46OpsReport | null;
  if (!report || report.version !== ARCHIVE_PHASE46_REPORT_VERSION) {
    return {
      report: empty,
      error: 'Phase 46 archive ops report contract mismatch',
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

export async function runArchivePhase46OpsTick(): Promise<
  | {
      ok: true;
      completionId?: string;
      completionStatus?: string;
      armId?: string;
      revisionId?: string;
      cadenceOpsId?: string;
      alertsRecorded: number;
      delivered: number;
      skipped: number;
      failed: number;
    }
  | { ok: false; error: string }
> {
  try {
    const sb = await createPersistClient();
    const meta = { contract_version: ARCHIVE_PHASE46_REPORT_VERSION };

    const { data: completionData, error: completionError } = await sb.rpc(
      'complete_docusign_first_quarterly_review_phase46',
      { p_metadata: meta },
    );
    if (completionError) return { ok: false, error: completionError.message };
    const completion = completionData as {
      completion_id?: string;
      status?: string;
      disposition?: string;
    } | null;

    const { data: armData, error: armError } = await sb.rpc(
      'arm_docusign_recurring_quarterly_phase46',
      {
        p_cadence_months: 3,
        p_metadata: meta,
      },
    );
    if (armError) return { ok: false, error: armError.message };
    const arm = armData as {
      arm_id?: string;
      disposition?: string;
      status?: string;
    } | null;

    const { data: tightenData, error: tightenError } = await sb.rpc(
      'tighten_docusign_drift_budget_phase46',
      {
        p_budget_key: DEFAULT_BUDGET_KEY,
        p_metadata: meta,
      },
    );
    if (tightenError) return { ok: false, error: tightenError.message };
    const tighten = tightenData as {
      revision_id?: string;
      disposition?: string;
      status?: string;
    } | null;

    let activatedRevisionId: string | undefined;
    if (tighten?.revision_id && tighten.status === 'proposed') {
      const { data: activateData, error: activateError } = await sb.rpc(
        'activate_docusign_drift_budget_revision_phase46',
        {
          p_revision_id: tighten.revision_id,
          p_metadata: meta,
        },
      );
      if (activateError) return { ok: false, error: activateError.message };
      const activated = activateData as {
        revision_id?: string;
        disposition?: string;
      } | null;
      if (
        activated?.disposition === 'activated' ||
        activated?.disposition === 'unchanged'
      ) {
        activatedRevisionId = activated.revision_id;
      }
    }

    const { data: cadenceData, error: cadenceError } = await sb.rpc(
      'record_docusign_integrity_cadence_ops_phase46',
      {
        p_metadata: meta,
        p_sample_sla_days: 7,
      },
    );
    if (cadenceError) return { ok: false, error: cadenceError.message };
    const cadence = cadenceData as { ops_id?: string } | null;

    const { data: windows, error: windowError } = await sb.rpc(
      'list_docusign_archive_phase46_critical_windows',
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
        kind: 'docusign_archive_phase46_ops_alert',
        version: ARCHIVE_PHASE46_REPORT_VERSION,
        alert_kind: window.alert_kind,
        window_key: window.window_key,
        severity: 'critical',
        destination_key: OPS_DESTINATION_KEY,
        metrics_sha256: window.metrics_sha256 ?? null,
      });

      const { data: recorded, error: recordError } = await sb.rpc(
        'record_docusign_archive_phase46_ops_alert',
        {
          p_alert: {
            alert_kind: window.alert_kind,
            window_key: window.window_key,
            destination_key: OPS_DESTINATION_KEY,
            delivery_status: delivery.delivery_status,
            response_code: delivery.response_code,
            metadata: {
              contract_version: ARCHIVE_PHASE46_REPORT_VERSION,
              completion_id: window.completion_id ?? null,
              budget_id: window.budget_id ?? null,
              baseline_snapshot_id: window.baseline_snapshot_id ?? null,
              ops_id: window.ops_id ?? null,
              health: window.health ?? null,
              sample_overdue: window.sample_overdue ?? null,
              full_overdue: window.full_overdue ?? null,
              quarterly_overdue: window.quarterly_overdue ?? null,
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
      completionId: completion?.completion_id,
      completionStatus: completion?.status,
      armId: arm?.arm_id,
      revisionId: activatedRevisionId ?? tighten?.revision_id,
      cadenceOpsId: cadence?.ops_id,
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
          : 'Phase 46 archive ops tick failed',
    };
  }
}
