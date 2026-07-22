import { webhookUrl } from '@/lib/shared-services/slo-delivery';
import { createPersistClient } from '@/lib/supabase/persist-client';

export const ARCHIVE_PHASE44_REPORT_VERSION = 'phase44-v1' as const;
const OPS_DESTINATION_KEY = 'ops_alerts';

export type ArchivePhase44AlertKind =
  | 'integrity_drift_burst'
  | 'quarantine_aging_breach'
  | 'quarantine_backlog_high'
  | 'backfill_stalled'
  | 'full_scan_overdue'
  | 'first_quarterly_still_gated'
  | 'storage_unavailable_elevated';

export type ArchivePhase44DeliveryStatus =
  | 'delivered'
  | 'skipped_no_webhook'
  | 'failed'
  | 'recorded'
  | 'none';

export type ArchivePhase44Health = 'healthy' | 'watch' | 'critical' | 'unknown';

export type ArchivePhase44OpsReport = {
  version: typeof ARCHIVE_PHASE44_REPORT_VERSION | string;
  drift_health: ArchivePhase44Health;
  backfill_health: ArchivePhase44Health;
  alert_delivery: ArchivePhase44DeliveryStatus;
  critical_alert_count: number;
  remaining_unhashed: number;
  quarantine_backlog: number;
  latest_drift: Record<string, unknown> | null;
  latest_backfill: Record<string, unknown> | null;
  drift_snapshots: Array<Record<string, unknown>>;
  alerts: Array<Record<string, unknown>>;
  destination_key: string;
};

type CriticalWindow = {
  alert_kind: ArchivePhase44AlertKind | string;
  window_key: string;
  severity?: string;
  metrics_sha256?: string;
  snapshot_id?: string;
  content_drift_count?: number;
  storage_unavailable_count?: number;
  quarantine_oldest_age_days?: number;
  quarantine_backlog?: number;
  remaining_unhashed?: number;
  burn_rate_per_hour?: number | null;
  quarterly_full_due?: boolean;
};

export function emptyArchivePhase44OpsReport(): ArchivePhase44OpsReport {
  return {
    version: ARCHIVE_PHASE44_REPORT_VERSION,
    drift_health: 'unknown',
    backfill_health: 'unknown',
    alert_delivery: 'none',
    critical_alert_count: 0,
    remaining_unhashed: 0,
    quarantine_backlog: 0,
    latest_drift: null,
    latest_backfill: null,
    drift_snapshots: [],
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

export async function getArchivePhase44OpsReport(input: {
  firmWide: boolean;
}): Promise<{ report: ArchivePhase44OpsReport; error?: string }> {
  const empty = emptyArchivePhase44OpsReport();
  if (!input.firmWide) {
    return { report: empty };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'get_docusign_archive_phase44_ops_report',
  );
  if (error) return { report: empty, error: error.message };
  const report = data as ArchivePhase44OpsReport | null;
  if (!report || report.version !== ARCHIVE_PHASE44_REPORT_VERSION) {
    return {
      report: empty,
      error: 'Phase 44 archive ops report contract mismatch',
    };
  }
  return {
    report: {
      ...empty,
      ...report,
      drift_snapshots: (report.drift_snapshots ?? []).slice(0, 8),
      alerts: (report.alerts ?? []).slice(0, 20),
      destination_key: report.destination_key || OPS_DESTINATION_KEY,
    },
  };
}

export async function runArchivePhase44OpsTick(input?: {
  windowDays?: number;
}): Promise<
  | {
      ok: true;
      driftSnapshotId?: string;
      backfillSnapshotId?: string;
      alertsRecorded: number;
      delivered: number;
      skipped: number;
      failed: number;
    }
  | { ok: false; error: string }
> {
  try {
    const sb = await createPersistClient();
    const windowDays = Math.min(
      Math.max(Math.trunc(input?.windowDays ?? 7), 1),
      90,
    );

    const { data: driftData, error: driftError } = await sb.rpc(
      'record_docusign_archive_drift_snapshot_phase44',
      {
        p_window_days: windowDays,
        p_metadata: { contract_version: ARCHIVE_PHASE44_REPORT_VERSION },
      },
    );
    if (driftError) return { ok: false, error: driftError.message };
    const drift = driftData as { snapshot_id?: string } | null;

    const { data: backfillData, error: backfillError } = await sb.rpc(
      'record_docusign_archive_backfill_snapshot_phase44',
      {
        p_metadata: { contract_version: ARCHIVE_PHASE44_REPORT_VERSION },
      },
    );
    if (backfillError) return { ok: false, error: backfillError.message };
    const backfill = backfillData as { snapshot_id?: string } | null;

    const { data: windows, error: windowError } = await sb.rpc(
      'list_docusign_archive_phase44_critical_windows',
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
        kind: 'docusign_archive_phase44_ops_alert',
        version: ARCHIVE_PHASE44_REPORT_VERSION,
        alert_kind: window.alert_kind,
        window_key: window.window_key,
        severity: 'critical',
        destination_key: OPS_DESTINATION_KEY,
        metrics_sha256: window.metrics_sha256 ?? null,
      });

      const { data: recorded, error: recordError } = await sb.rpc(
        'record_docusign_archive_phase44_ops_alert',
        {
          p_alert: {
            alert_kind: window.alert_kind,
            window_key: window.window_key,
            destination_key: OPS_DESTINATION_KEY,
            delivery_status: delivery.delivery_status,
            response_code: delivery.response_code,
            metadata: {
              contract_version: ARCHIVE_PHASE44_REPORT_VERSION,
              snapshot_id: window.snapshot_id ?? null,
              content_drift_count: window.content_drift_count ?? null,
              storage_unavailable_count:
                window.storage_unavailable_count ?? null,
              remaining_unhashed: window.remaining_unhashed ?? null,
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
      driftSnapshotId: drift?.snapshot_id,
      backfillSnapshotId: backfill?.snapshot_id,
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
          : 'Phase 44 archive ops tick failed',
    };
  }
}
