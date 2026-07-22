import { createClient } from '@supabase/supabase-js';
import {
  REVENUE_REPORT_VERSION_PHASE50,
  type Phase50RevenueOpsReport,
} from '@/lib/shared-services/marketing-revenue-contracts';
import { webhookUrl } from '@/lib/shared-services/slo-delivery';
import { createPersistClient } from '@/lib/supabase/persist-client';

const OPS_DESTINATION_KEY = 'ops_alerts';
const DEFAULT_READINESS_ACTOR = '00000000-0000-4000-8000-000000000050';

export function emptyPhase50RevenueOpsReport(): Phase50RevenueOpsReport {
  return {
    version: REVENUE_REPORT_VERSION_PHASE50,
    window_days: 30,
    promotion_health: 'unknown',
    alert_delivery: 'none',
    pending_proposal_count: 0,
    applied_proposal_count: 0,
    blocked_proposal_count: 0,
    rejected_proposal_count: 0,
    proposals: [],
    cohort_readiness: [],
    alerts: [],
    destination_key: OPS_DESTINATION_KEY,
    never_auto_approves_money: true,
  };
}

export async function getPhase50RevenueOpsReport(input: {
  entityId: string | null;
  firmWide: boolean;
  days: 7 | 30 | 90;
}): Promise<{ report: Phase50RevenueOpsReport; error?: string }> {
  const empty = emptyPhase50RevenueOpsReport();
  if (!input.firmWide && !input.entityId) {
    return {
      report: empty,
      error: 'Entity-scoped Phase 50 ops report requires an entity',
    };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'get_marketing_revenue_phase50_ops_report',
    {
      p_entity_id: input.entityId,
      p_days: input.days,
    },
  );
  if (error) return { report: empty, error: error.message };
  const report = data as Phase50RevenueOpsReport | null;
  if (!report || report.version !== REVENUE_REPORT_VERSION_PHASE50) {
    return {
      report: empty,
      error: 'Phase 50 revenue ops report contract mismatch',
    };
  }
  return {
    report: {
      ...empty,
      ...report,
      proposals: (report.proposals ?? []).slice(0, 50),
      cohort_readiness: (report.cohort_readiness ?? []).slice(0, 50),
      alerts: (report.alerts ?? []).slice(0, 50),
      destination_key: report.destination_key || OPS_DESTINATION_KEY,
    },
  };
}

// Propose (NEVER auto-approve) a dual-approve promotion from an existing
// Phase 49 dry-run snapshot that predicted 'would_promote'.
export async function proposeMarketingDryRunPromotePhase50(input: {
  dryRunId: string;
  proposedBy: string;
}): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'propose_marketing_dry_run_promote_phase50',
    {
      p_payload: {
        dry_run_id: input.dryRunId,
        proposed_by: input.proposedBy,
        metadata: { contract_version: REVENUE_REPORT_VERSION_PHASE50 },
      },
    },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? {}) as Record<string, unknown> };
}

// Dual-human approval gate. Only after 2 DISTINCT approving actors does this
// call the existing Phase 47 cohort auto-reject promote RPC. ALWAYS requires
// human approval for money — this function never auto-approves.
export async function approveMarketingDryRunPromotePhase50(input: {
  proposalId: string;
  actorId: string;
  decision: 'approve' | 'reject';
}): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'approve_marketing_dry_run_promote_phase50',
    {
      p_proposal_id: input.proposalId,
      p_actor_id: input.actorId,
      p_decision: input.decision,
      p_metadata: { contract_version: REVENUE_REPORT_VERSION_PHASE50 },
    },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? {}) as Record<string, unknown> };
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Phase 50 ops ticks require service-role configuration');
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

function readinessActorId(): string {
  const raw = process.env.MARKETING_AUTOPILOT_ACTOR_ID?.trim();
  if (raw && /^[0-9a-f-]{36}$/i.test(raw)) return raw;
  return DEFAULT_READINESS_ACTOR;
}

type CriticalWindow = {
  alert_kind: string;
  cohort_id?: string | null;
  proposal_id?: string | null;
  window_key: string;
  severity: string;
  metrics_sha256?: string;
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

export async function runPhase50RevenueOpsTick(): Promise<
  | {
      ok: true;
      readinessSnapshotsRecorded: number;
      alertsRecorded: number;
      delivered: number;
      skipped: number;
      failed: number;
    }
  | { ok: false; error: string }
> {
  try {
    const sb = serviceClient();

    // Read + append-only visibility snapshot. NEVER proposes or approves.
    const { data: readinessResult, error: readinessError } = await sb.rpc(
      'record_marketing_cohort_readiness_snapshot_phase50',
      {
        p_payload: {
          actor_id: readinessActorId(),
          metadata: {
            contract_version: REVENUE_REPORT_VERSION_PHASE50,
            never_auto_approves_money: true,
          },
        },
      },
    );
    if (readinessError) return { ok: false, error: readinessError.message };
    const readinessSnapshotsRecorded = Number(
      (readinessResult as { snapshots_recorded?: number } | null)
        ?.snapshots_recorded ?? 0,
    );

    const { data: windows, error: windowError } = await sb.rpc(
      'list_marketing_revenue_phase50_critical_windows',
      {
        p_days: 30,
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
        kind: 'marketing_revenue_phase50_ops_alert',
        version: REVENUE_REPORT_VERSION_PHASE50,
        alert_kind: window.alert_kind,
        cohort_id: window.cohort_id ?? null,
        proposal_id: window.proposal_id ?? null,
        window_key: window.window_key,
        severity: 'critical',
        destination_key: OPS_DESTINATION_KEY,
        metrics_sha256: window.metrics_sha256 ?? null,
      });

      const { data: recorded, error: recordError } = await sb.rpc(
        'record_marketing_revenue_phase50_ops_alert',
        {
          p_alert: {
            alert_kind: window.alert_kind,
            cohort_id: window.cohort_id ?? null,
            proposal_id: window.proposal_id ?? null,
            window_key: window.window_key,
            destination_key: OPS_DESTINATION_KEY,
            delivery_status: delivery.delivery_status,
            response_code: delivery.response_code,
            metadata: {
              contract_version: REVENUE_REPORT_VERSION_PHASE50,
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
      readinessSnapshotsRecorded,
      alertsRecorded,
      delivered,
      skipped,
      failed,
    };
  } catch (caught) {
    return {
      ok: false,
      error:
        caught instanceof Error ? caught.message : 'Phase 50 ops tick failed',
    };
  }
}
