import { createClient } from '@supabase/supabase-js';
import { webhookUrl } from '@/lib/shared-services/slo-delivery';
import { createPersistClient } from '@/lib/supabase/persist-client';

export const REVENUE_REPORT_VERSION_PHASE51 = 'phase51-v1' as const;
const OPS_DESTINATION_KEY = 'ops_alerts';
const DEFAULT_AUTO_PROPOSE_ACTOR = '00000000-0000-4000-8000-000000000051';

export type Phase51AutoProposeRun = {
  run_id: string;
  cohort_id: string;
  consecutive_ready_snapshots: number;
  windows_required: number;
  disposition: string;
  proposal_id: string | null;
  block_reason: string | null;
  metrics_sha256: string;
  created_at: string;
};

export type Phase51CohortStatus = {
  cohort_id: string;
  readiness_status: string;
  consecutive_healthy_windows: number;
  windows_required: number;
  readiness_created_at: string;
  latest_proposal_id: string | null;
  latest_proposal_status: string | null;
  latest_proposal_created_at: string | null;
};

export type Phase51OpsAlert = {
  alert_id: string;
  cohort_id?: string | null;
  run_id?: string | null;
  proposal_id?: string | null;
  alert_kind: string;
  window_key: string;
  severity: string;
  destination_key: string;
  delivery_status: string;
  response_code: number | null;
  metrics_sha256: string;
  created_at: string;
};

export type Phase51RevenueOpsReport = {
  version: typeof REVENUE_REPORT_VERSION_PHASE51 | string;
  window_days: number;
  auto_propose_created_count: number;
  auto_propose_skipped_count: number;
  auto_propose_errored_count: number;
  auto_propose_runs: Phase51AutoProposeRun[];
  cohort_status: Phase51CohortStatus[];
  alerts: Phase51OpsAlert[];
  destination_key: string;
  never_auto_approves_money: boolean;
  never_auto_approves: boolean;
};

export function emptyPhase51RevenueOpsReport(): Phase51RevenueOpsReport {
  return {
    version: REVENUE_REPORT_VERSION_PHASE51,
    window_days: 30,
    auto_propose_created_count: 0,
    auto_propose_skipped_count: 0,
    auto_propose_errored_count: 0,
    auto_propose_runs: [],
    cohort_status: [],
    alerts: [],
    destination_key: OPS_DESTINATION_KEY,
    never_auto_approves_money: true,
    never_auto_approves: true,
  };
}

export async function getPhase51RevenueOpsReport(input: {
  firmWide: boolean;
  days?: 7 | 30 | 90;
}): Promise<{ report: Phase51RevenueOpsReport; error?: string }> {
  const empty = emptyPhase51RevenueOpsReport();
  if (!input.firmWide) {
    return { report: empty };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'get_marketing_revenue_phase51_ops_report',
    { p_days: input.days ?? 30 },
  );
  if (error) return { report: empty, error: error.message };
  const report = data as Phase51RevenueOpsReport | null;
  if (!report || report.version !== REVENUE_REPORT_VERSION_PHASE51) {
    return {
      report: empty,
      error: 'Phase 51 revenue ops report contract mismatch',
    };
  }
  return {
    report: {
      ...empty,
      ...report,
      auto_propose_runs: (report.auto_propose_runs ?? []).slice(0, 50),
      cohort_status: (report.cohort_status ?? []).slice(0, 50),
      alerts: (report.alerts ?? []).slice(0, 50),
      destination_key: report.destination_key || OPS_DESTINATION_KEY,
    },
  };
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Phase 51 ops ticks require service-role configuration');
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

function autoProposeActorId(): string {
  const raw = process.env.MARKETING_AUTOPILOT_ACTOR_ID?.trim();
  if (raw && /^[0-9a-f-]{36}$/i.test(raw)) return raw;
  return DEFAULT_AUTO_PROPOSE_ACTOR;
}

function autoProposeWindowsRequired(): number {
  const raw = Number(process.env.MARKETING_PHASE51_AUTO_PROPOSE_WINDOWS ?? 3);
  if (!Number.isFinite(raw)) return 3;
  return Math.min(Math.max(Math.trunc(raw), 1), 12);
}

type CriticalWindow = {
  alert_kind: string;
  cohort_id?: string | null;
  run_id?: string | null;
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

/**
 * Auto-PROPOSE (NEVER auto-approve) dual-approve promotions for cohorts
 * that have soaked healthy for N consecutive Phase 50 cohort readiness
 * snapshots. This tick only ever calls the Phase 51 auto-propose RPC, which
 * itself only ever calls the existing Phase 50 propose RPC — it never
 * approves or promotes. Two distinct humans must still review and approve
 * every promotion.
 */
export async function runPhase51RevenueOpsTick(): Promise<
  | {
      ok: true;
      cohortsScanned: number;
      proposalsCreated: number;
      skipped: number;
      errored: number;
      alertsRecorded: number;
      delivered: number;
      alertsSkipped: number;
      alertsFailed: number;
    }
  | { ok: false; error: string }
> {
  try {
    const sb = serviceClient();

    // ONLY ever calls propose_marketing_dry_run_promote_phase50 — NEVER
    // calls approve_marketing_dry_run_promote_phase50. Two distinct humans
    // must still approve every promotion.
    const { data: autoProposeResult, error: autoProposeError } = await sb.rpc(
      'auto_propose_marketing_dry_run_promote_phase51',
      {
        p_actor_id: autoProposeActorId(),
        p_windows_required: autoProposeWindowsRequired(),
      },
    );
    if (autoProposeError) return { ok: false, error: autoProposeError.message };
    const autoPropose = autoProposeResult as {
      cohorts_scanned?: number;
      proposals_created?: number;
      skipped?: number;
      errored?: number;
    } | null;

    const { data: windows, error: windowError } = await sb.rpc(
      'list_marketing_revenue_phase51_critical_windows',
      { p_window_hours: alertCooldownHours() },
    );
    if (windowError) return { ok: false, error: windowError.message };

    const pending = ((windows as { pending?: CriticalWindow[] } | null)
      ?.pending ?? []) as CriticalWindow[];
    let alertsRecorded = 0;
    let delivered = 0;
    let alertsSkipped = 0;
    let alertsFailed = 0;

    for (const window of pending.slice(0, 50)) {
      const delivery = await deliverOpsWebhook({
        kind: 'marketing_revenue_phase51_ops_alert',
        version: REVENUE_REPORT_VERSION_PHASE51,
        alert_kind: window.alert_kind,
        cohort_id: window.cohort_id ?? null,
        run_id: window.run_id ?? null,
        proposal_id: window.proposal_id ?? null,
        window_key: window.window_key,
        severity: window.severity ?? 'warning',
        destination_key: OPS_DESTINATION_KEY,
        metrics_sha256: window.metrics_sha256 ?? null,
      });

      const { data: recorded, error: recordError } = await sb.rpc(
        'record_marketing_revenue_phase51_ops_alert',
        {
          p_alert: {
            alert_kind: window.alert_kind,
            cohort_id: window.cohort_id ?? null,
            run_id: window.run_id ?? null,
            proposal_id: window.proposal_id ?? null,
            window_key: window.window_key,
            severity: window.severity ?? 'warning',
            destination_key: OPS_DESTINATION_KEY,
            delivery_status: delivery.delivery_status,
            response_code: delivery.response_code,
            metadata: {
              contract_version: REVENUE_REPORT_VERSION_PHASE51,
              never_auto_approves_money: true,
              never_auto_approves: true,
            },
          },
        },
      );
      if (recordError) return { ok: false, error: recordError.message };
      if ((recorded as { inserted?: boolean } | null)?.inserted) {
        alertsRecorded += 1;
        if (delivery.delivery_status === 'delivered') delivered += 1;
        else if (delivery.delivery_status === 'skipped_no_webhook') alertsSkipped += 1;
        else alertsFailed += 1;
      }
    }

    return {
      ok: true,
      cohortsScanned: Number(autoPropose?.cohorts_scanned ?? 0),
      proposalsCreated: Number(autoPropose?.proposals_created ?? 0),
      skipped: Number(autoPropose?.skipped ?? 0),
      errored: Number(autoPropose?.errored ?? 0),
      alertsRecorded,
      delivered,
      alertsSkipped,
      alertsFailed,
    };
  } catch (caught) {
    return {
      ok: false,
      error:
        caught instanceof Error ? caught.message : 'Phase 51 ops tick failed',
    };
  }
}
