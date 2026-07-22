import { webhookUrl } from '@/lib/shared-services/slo-delivery';
import { createPersistClient } from '@/lib/supabase/persist-client';

export const ARCHIVE_PHASE49_REPORT_VERSION = 'phase49-v1' as const;
const OPS_DESTINATION_KEY = 'ops_alerts';

export type ArchivePhase49AlertKind =
  | 'cadence_slo_breach'
  | 'budget_revision_proposed'
  | 'budget_revision_activated';

export type ArchivePhase49DeliveryStatus =
  | 'delivered'
  | 'skipped_no_webhook'
  | 'failed'
  | 'recorded'
  | 'none';

export type ArchivePhase49CadenceSeverity =
  | 'unknown'
  | 'healthy'
  | 'warning'
  | 'critical';

export type ArchivePhase49BudgetProposalStatus =
  | 'none'
  | 'proposed'
  | 'activated'
  | 'rejected'
  | 'blocked';

export type ArchivePhase49OpsReport = {
  version: typeof ARCHIVE_PHASE49_REPORT_VERSION | string;
  cadence_slo_severity: ArchivePhase49CadenceSeverity | string;
  cadence_on_time_rate: number | null;
  cadence_breach: boolean;
  budget_proposal_status: ArchivePhase49BudgetProposalStatus | string;
  pending_proposal_count: number;
  activated_proposal_count: number;
  recurring_run_status: string;
  drift_performance: string;
  alert_delivery: ArchivePhase49DeliveryStatus;
  latest_cadence_slo: Record<string, unknown> | null;
  latest_budget_proposal: Record<string, unknown> | null;
  alerts: Array<Record<string, unknown>>;
  destination_key: string;
  never_creates_voids_or_resends_envelopes: boolean;
};

type CriticalWindow = {
  alert_kind: ArchivePhase49AlertKind | string;
  window_key: string;
  severity?: string;
  metrics_sha256?: string;
  slo_id?: string;
  proposal_id?: string;
  budget_key?: string;
  on_time_rate?: number | null;
  quarters_evaluated?: number | null;
};

export function emptyArchivePhase49OpsReport(): ArchivePhase49OpsReport {
  return {
    version: ARCHIVE_PHASE49_REPORT_VERSION,
    cadence_slo_severity: 'unknown',
    cadence_on_time_rate: null,
    cadence_breach: false,
    budget_proposal_status: 'none',
    pending_proposal_count: 0,
    activated_proposal_count: 0,
    recurring_run_status: 'none',
    drift_performance: 'unknown',
    alert_delivery: 'none',
    latest_cadence_slo: null,
    latest_budget_proposal: null,
    alerts: [],
    destination_key: OPS_DESTINATION_KEY,
    never_creates_voids_or_resends_envelopes: true,
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

export async function getArchivePhase49OpsReport(input: {
  firmWide: boolean;
}): Promise<{ report: ArchivePhase49OpsReport; error?: string }> {
  const empty = emptyArchivePhase49OpsReport();
  if (!input.firmWide) {
    return { report: empty };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'get_docusign_archive_phase49_ops_report',
  );
  if (error) return { report: empty, error: error.message };
  const report = data as ArchivePhase49OpsReport | null;
  if (!report || report.version !== ARCHIVE_PHASE49_REPORT_VERSION) {
    return {
      report: empty,
      error: 'Phase 49 archive ops report contract mismatch',
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

export async function approveDocusignBudgetRevisionProposalPhase49(input: {
  proposalId: string;
  actorId: string;
  decision: 'approve' | 'reject';
}): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'approve_docusign_budget_revision_proposal_phase49',
    {
      p_proposal_id: input.proposalId,
      p_actor_id: input.actorId,
      p_decision: input.decision,
      p_metadata: { contract_version: ARCHIVE_PHASE49_REPORT_VERSION },
    },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? {}) as Record<string, unknown> };
}

export async function runArchivePhase49OpsTick(): Promise<
  | {
      ok: true;
      cadenceSloId?: string;
      cadenceSeverity?: string;
      proposalId?: string;
      proposalStatus?: string;
      alertsRecorded: number;
      delivered: number;
      skipped: number;
      failed: number;
    }
  | { ok: false; error: string }
> {
  try {
    const sb = await createPersistClient();
    const meta = { contract_version: ARCHIVE_PHASE49_REPORT_VERSION };

    const { data: cadenceData, error: cadenceError } = await sb.rpc(
      'record_docusign_multi_quarter_cadence_slo_phase49',
      { p_metadata: meta, p_window_quarters: 4 },
    );
    if (cadenceError) return { ok: false, error: cadenceError.message };
    const cadence = cadenceData as {
      slo_id?: string;
      severity?: string;
    } | null;

    // Propose only — NEVER silently activates. Activation requires the
    // distinct dual-human approval RPC above.
    const { data: proposeData, error: proposeError } = await sb.rpc(
      'propose_docusign_budget_revision_phase49',
      { p_metadata: meta, p_lookback_days: 30 },
    );
    if (proposeError) return { ok: false, error: proposeError.message };
    const propose = proposeData as {
      proposal_id?: string;
      status?: string;
    } | null;

    const { data: windows, error: windowError } = await sb.rpc(
      'list_docusign_archive_phase49_critical_windows',
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
        kind: 'docusign_archive_phase49_ops_alert',
        version: ARCHIVE_PHASE49_REPORT_VERSION,
        alert_kind: window.alert_kind,
        window_key: window.window_key,
        severity: 'critical',
        destination_key: OPS_DESTINATION_KEY,
        metrics_sha256: window.metrics_sha256 ?? null,
      });

      const { data: recorded, error: recordError } = await sb.rpc(
        'record_docusign_archive_phase49_ops_alert',
        {
          p_alert: {
            alert_kind: window.alert_kind,
            window_key: window.window_key,
            destination_key: OPS_DESTINATION_KEY,
            delivery_status: delivery.delivery_status,
            response_code: delivery.response_code,
            metadata: {
              contract_version: ARCHIVE_PHASE49_REPORT_VERSION,
              slo_id: window.slo_id ?? null,
              proposal_id: window.proposal_id ?? null,
              budget_key: window.budget_key ?? null,
              on_time_rate: window.on_time_rate ?? null,
              quarters_evaluated: window.quarters_evaluated ?? null,
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
      cadenceSloId: cadence?.slo_id,
      cadenceSeverity: cadence?.severity,
      proposalId: propose?.proposal_id,
      proposalStatus: propose?.status,
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
          : 'Phase 49 archive ops tick failed',
    };
  }
}
