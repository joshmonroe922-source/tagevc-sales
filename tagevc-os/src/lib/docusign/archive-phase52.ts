import { webhookUrl } from '@/lib/shared-services/slo-delivery';
import { createPersistClient } from '@/lib/supabase/persist-client';

export const ARCHIVE_PHASE52_REPORT_VERSION = 'phase52-v1' as const;
const OPS_DESTINATION_KEY = 'ops_alerts';

export type ArchivePhase52AlertKind =
  | 'fourth_approver_escalation_raised'
  | 'escalation_chain_aging_critical';

export type ArchivePhase52OpsReport = {
  version: typeof ARCHIVE_PHASE52_REPORT_VERSION | string;
  chain_threshold_days: number;
  chain_active: boolean;
  fourth_approver_escalations_7d: number;
  pending_fourth_approver_count: number;
  avg_fourth_escalation_age_days: number | null;
  recent_fourth_escalations: Array<Record<string, unknown>>;
  alerts: Array<Record<string, unknown>>;
  destination_key: string;
  never_creates_voids_or_resends_envelopes: boolean;
  never_auto_activates: boolean;
};

type CriticalWindow = {
  alert_kind: ArchivePhase52AlertKind | string;
  window_key: string;
  severity?: string;
  proposal_id?: string;
  escalation_id?: string;
  days_since_third_escalation?: number;
  age_days?: number;
  metrics_sha256?: string;
};

export function emptyArchivePhase52OpsReport(): ArchivePhase52OpsReport {
  return {
    version: ARCHIVE_PHASE52_REPORT_VERSION,
    chain_threshold_days: 3,
    chain_active: false,
    fourth_approver_escalations_7d: 0,
    pending_fourth_approver_count: 0,
    avg_fourth_escalation_age_days: null,
    recent_fourth_escalations: [],
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

function chainThresholdDays(): number {
  const raw = Number(
    process.env.DOCUSIGN_PHASE52_FOURTH_ESCALATION_THRESHOLD_DAYS ??
      process.env.DOCUSIGN_PHASE51_ESCALATION_THRESHOLD_DAYS ??
      3,
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

export async function getArchivePhase52OpsReport(input: {
  firmWide: boolean;
}): Promise<{ report: ArchivePhase52OpsReport; error?: string }> {
  const empty = emptyArchivePhase52OpsReport();
  if (!input.firmWide) {
    return { report: empty };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'get_docusign_archive_phase52_ops_report',
  );
  if (error) return { report: empty, error: error.message };
  const report = data as ArchivePhase52OpsReport | null;
  if (!report || report.version !== ARCHIVE_PHASE52_REPORT_VERSION) {
    return {
      report: empty,
      error: 'Phase 52 archive ops report contract mismatch',
    };
  }
  return {
    report: {
      ...empty,
      ...report,
      recent_fourth_escalations: (
        report.recent_fourth_escalations ?? []
      ).slice(0, 25),
      alerts: (report.alerts ?? []).slice(0, 20),
      destination_key: report.destination_key || OPS_DESTINATION_KEY,
    },
  };
}

export async function runArchivePhase52OpsTick(): Promise<
  | {
      ok: true;
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
    const meta = {
      contract_version: ARCHIVE_PHASE52_REPORT_VERSION,
      never_activates: true,
    };

    // Read + append-only. Never creates/voids/resends envelopes.
    const { data: chainData, error: chainError } = await sb.rpc(
      'escalate_docusign_approval_chain_phase52',
      {
        p_threshold_days: chainThresholdDays(),
        p_metadata: meta,
      },
    );
    if (chainError) return { ok: false, error: chainError.message };
    const chain = chainData as { escalations_raised?: number } | null;

    const { data: windows, error: windowError } = await sb.rpc(
      'list_docusign_archive_phase52_critical_windows',
      {
        p_window_hours: alertCooldownHours(),
        p_aging_threshold_days: Math.min(chainThresholdDays() * 2, 60),
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
        kind: 'docusign_archive_phase52_ops_alert',
        version: ARCHIVE_PHASE52_REPORT_VERSION,
        alert_kind: window.alert_kind,
        window_key: window.window_key,
        severity: window.severity ?? 'warning',
        destination_key: OPS_DESTINATION_KEY,
        proposal_id: window.proposal_id ?? null,
        metrics_sha256: window.metrics_sha256 ?? null,
      });

      const { data: recorded, error: recordError } = await sb.rpc(
        'record_docusign_archive_phase52_ops_alert',
        {
          p_alert: {
            alert_kind: window.alert_kind,
            window_key: window.window_key,
            severity: window.severity ?? 'warning',
            destination_key: OPS_DESTINATION_KEY,
            delivery_status: delivery.delivery_status,
            response_code: delivery.response_code,
            metadata: {
              contract_version: ARCHIVE_PHASE52_REPORT_VERSION,
              proposal_id: window.proposal_id ?? null,
              escalation_id: window.escalation_id ?? null,
              never_activates: true,
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
      escalationsRaised: Number(chain?.escalations_raised ?? 0),
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
          : 'Phase 52 archive ops tick failed',
    };
  }
}
