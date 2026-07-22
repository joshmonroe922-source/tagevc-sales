import { webhookUrl } from '@/lib/shared-services/slo-delivery';
import { createPersistClient } from '@/lib/supabase/persist-client';

export const ARCHIVE_PHASE45_REPORT_VERSION = 'phase45-v1' as const;
const OPS_DESTINATION_KEY = 'ops_alerts';
const DEFAULT_BUDGET_KEY = 'firm_signed_archives';

export type ArchivePhase45AlertKind =
  | 'drift_budget_breach'
  | 'gate_clearing_stalled'
  | 'recurring_quarterly_unarmed'
  | 'integrity_cadence_overdue';

export type ArchivePhase45DeliveryStatus =
  | 'delivered'
  | 'skipped_no_webhook'
  | 'failed'
  | 'recorded'
  | 'none';

export type ArchivePhase45Health = 'healthy' | 'watch' | 'critical' | 'unknown';

export type ArchivePhase45GateProgress =
  | 'blocked'
  | 'partial'
  | 'ready'
  | 'advancing'
  | 'armed'
  | 'unknown';

export type ArchivePhase45OpsReport = {
  version: typeof ARCHIVE_PHASE45_REPORT_VERSION | string;
  gate_clearing_progress: ArchivePhase45GateProgress | string;
  steps_cleared: number;
  steps_total: number;
  drift_budget_health: ArchivePhase45Health;
  cadence_health: ArchivePhase45Health;
  alert_delivery: ArchivePhase45DeliveryStatus;
  critical_alert_count: number;
  remaining_unhashed: number;
  quarantine_backlog: number;
  first_quarterly_ready: boolean;
  first_quarterly_completed: boolean;
  recurring_quarterly_armed: boolean;
  latest_budget: Record<string, unknown> | null;
  latest_cadence: Record<string, unknown> | null;
  gate_evidence: Array<Record<string, unknown>>;
  alerts: Array<Record<string, unknown>>;
  destination_key: string;
};

type CriticalWindow = {
  alert_kind: ArchivePhase45AlertKind | string;
  window_key: string;
  severity?: string;
  metrics_sha256?: string;
  budget_id?: string;
  snapshot_id?: string;
  content_drift_count?: number;
  storage_unavailable_count?: number;
  max_content_drift_per_window?: number;
  max_storage_unavailable?: number;
  steps_cleared?: number;
  steps_total?: number;
  remaining_unhashed?: number;
  quarantine_backlog?: number;
  quarantine_oldest_days?: number;
  sample_overdue?: boolean;
  full_overdue?: boolean;
  last_sample_at?: string | null;
  last_full_at?: string | null;
  next_quarterly_due?: string | null;
};

export function emptyArchivePhase45OpsReport(): ArchivePhase45OpsReport {
  return {
    version: ARCHIVE_PHASE45_REPORT_VERSION,
    gate_clearing_progress: 'unknown',
    steps_cleared: 0,
    steps_total: 6,
    drift_budget_health: 'unknown',
    cadence_health: 'unknown',
    alert_delivery: 'none',
    critical_alert_count: 0,
    remaining_unhashed: 0,
    quarantine_backlog: 0,
    first_quarterly_ready: false,
    first_quarterly_completed: false,
    recurring_quarterly_armed: false,
    latest_budget: null,
    latest_cadence: null,
    gate_evidence: [],
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

function defaultDriftBudgetLimits() {
  const maxDrift = Number(
    process.env.DOCUSIGN_ARCHIVE_DRIFT_BUDGET_MAX_CONTENT ?? 2,
  );
  const maxStorage = Number(
    process.env.DOCUSIGN_ARCHIVE_DRIFT_BUDGET_MAX_STORAGE ?? 4,
  );
  const windowDays = Number(
    process.env.DOCUSIGN_ARCHIVE_DRIFT_BUDGET_WINDOW_DAYS ?? 7,
  );
  return {
    maxContentDrift: Number.isFinite(maxDrift)
      ? Math.min(Math.max(Math.trunc(maxDrift), 0), 1000)
      : 2,
    maxStorageUnavailable: Number.isFinite(maxStorage)
      ? Math.min(Math.max(Math.trunc(maxStorage), 0), 1000)
      : 4,
    windowDays: Number.isFinite(windowDays)
      ? Math.min(Math.max(Math.trunc(windowDays), 1), 90)
      : 7,
  };
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

export async function getArchivePhase45OpsReport(input: {
  firmWide: boolean;
}): Promise<{ report: ArchivePhase45OpsReport; error?: string }> {
  const empty = emptyArchivePhase45OpsReport();
  if (!input.firmWide) {
    return { report: empty };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'get_docusign_archive_phase45_ops_report',
  );
  if (error) return { report: empty, error: error.message };
  const report = data as ArchivePhase45OpsReport | null;
  if (!report || report.version !== ARCHIVE_PHASE45_REPORT_VERSION) {
    return {
      report: empty,
      error: 'Phase 45 archive ops report contract mismatch',
    };
  }
  return {
    report: {
      ...empty,
      ...report,
      gate_evidence: (report.gate_evidence ?? []).slice(0, 12),
      alerts: (report.alerts ?? []).slice(0, 20),
      destination_key: report.destination_key || OPS_DESTINATION_KEY,
    },
  };
}

export async function runArchivePhase45OpsTick(): Promise<
  | {
      ok: true;
      budgetId?: string;
      cadenceSnapshotId?: string;
      gateStepsRecorded: number;
      alertsRecorded: number;
      delivered: number;
      skipped: number;
      failed: number;
    }
  | { ok: false; error: string }
> {
  try {
    const sb = await createPersistClient();
    const limits = defaultDriftBudgetLimits();

    const { data: budgetData, error: budgetError } = await sb.rpc(
      'upsert_docusign_archive_drift_budget_phase45',
      {
        p_budget_key: DEFAULT_BUDGET_KEY,
        p_max_content_drift_per_window: limits.maxContentDrift,
        p_max_storage_unavailable: limits.maxStorageUnavailable,
        p_window_days: limits.windowDays,
        p_status: 'active',
        p_metadata: { contract_version: ARCHIVE_PHASE45_REPORT_VERSION },
      },
    );
    if (budgetError) return { ok: false, error: budgetError.message };
    const budget = budgetData as { budget_id?: string } | null;

    const { data: gateData, error: gateError } = await sb.rpc(
      'evaluate_docusign_gate_clearing_phase45',
      {
        p_metadata: { contract_version: ARCHIVE_PHASE45_REPORT_VERSION },
      },
    );
    if (gateError) return { ok: false, error: gateError.message };
    const gate = gateData as { recorded_count?: number } | null;

    const { data: cadenceData, error: cadenceError } = await sb.rpc(
      'record_docusign_integrity_cadence_snapshot_phase45',
      {
        p_metadata: { contract_version: ARCHIVE_PHASE45_REPORT_VERSION },
        p_sample_sla_days: 7,
      },
    );
    if (cadenceError) return { ok: false, error: cadenceError.message };
    const cadence = cadenceData as { snapshot_id?: string } | null;

    const { data: windows, error: windowError } = await sb.rpc(
      'list_docusign_archive_phase45_critical_windows',
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
        kind: 'docusign_archive_phase45_ops_alert',
        version: ARCHIVE_PHASE45_REPORT_VERSION,
        alert_kind: window.alert_kind,
        window_key: window.window_key,
        severity: 'critical',
        destination_key: OPS_DESTINATION_KEY,
        metrics_sha256: window.metrics_sha256 ?? null,
      });

      const { data: recorded, error: recordError } = await sb.rpc(
        'record_docusign_archive_phase45_ops_alert',
        {
          p_alert: {
            alert_kind: window.alert_kind,
            window_key: window.window_key,
            destination_key: OPS_DESTINATION_KEY,
            delivery_status: delivery.delivery_status,
            response_code: delivery.response_code,
            metadata: {
              contract_version: ARCHIVE_PHASE45_REPORT_VERSION,
              budget_id: window.budget_id ?? null,
              snapshot_id: window.snapshot_id ?? null,
              content_drift_count: window.content_drift_count ?? null,
              storage_unavailable_count:
                window.storage_unavailable_count ?? null,
              remaining_unhashed: window.remaining_unhashed ?? null,
              sample_overdue: window.sample_overdue ?? null,
              full_overdue: window.full_overdue ?? null,
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
      budgetId: budget?.budget_id,
      cadenceSnapshotId: cadence?.snapshot_id,
      gateStepsRecorded: gate?.recorded_count ?? 0,
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
          : 'Phase 45 archive ops tick failed',
    };
  }
}
