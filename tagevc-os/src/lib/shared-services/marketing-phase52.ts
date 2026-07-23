import { createClient } from '@supabase/supabase-js';
import { webhookUrl } from '@/lib/shared-services/slo-delivery';
import { createPersistClient } from '@/lib/supabase/persist-client';

export const REVENUE_REPORT_VERSION_PHASE52 = 'phase52-v1' as const;
const OPS_DESTINATION_KEY = 'ops_alerts';

export type Phase52PendingItem = {
  proposal_id: string;
  cohort_id: string;
  status: string;
  created_at: string;
  distinct_approvers: number;
  approval_stage: string;
};

export type Phase52DigestSnapshot = {
  digest_id: string;
  awaiting_first_approval_count: number;
  awaiting_second_approval_count: number;
  total_pending_count: number;
  oldest_pending_hours: number | null;
  metrics_sha256: string;
  created_at: string;
};

export type Phase52OpsAlert = {
  alert_id: string;
  digest_id?: string | null;
  alert_kind: string;
  window_key: string;
  severity: string;
  destination_key: string;
  delivery_status: string;
  response_code: number | null;
  metrics_sha256: string;
  created_at: string;
};

export type Phase52RevenueOpsReport = {
  version: typeof REVENUE_REPORT_VERSION_PHASE52 | string;
  window_days: number;
  awaiting_first_approval_count: number;
  awaiting_second_approval_count: number;
  total_pending_count: number;
  pending_items: Phase52PendingItem[];
  digest_snapshot_count: number;
  recent_digests: Phase52DigestSnapshot[];
  alerts: Phase52OpsAlert[];
  destination_key: string;
  never_auto_approves_money: boolean;
  never_auto_approves: boolean;
};

export function emptyPhase52RevenueOpsReport(): Phase52RevenueOpsReport {
  return {
    version: REVENUE_REPORT_VERSION_PHASE52,
    window_days: 30,
    awaiting_first_approval_count: 0,
    awaiting_second_approval_count: 0,
    total_pending_count: 0,
    pending_items: [],
    digest_snapshot_count: 0,
    recent_digests: [],
    alerts: [],
    destination_key: OPS_DESTINATION_KEY,
    never_auto_approves_money: true,
    never_auto_approves: true,
  };
}

export async function getPhase52RevenueOpsReport(input: {
  firmWide: boolean;
  days?: 7 | 30 | 90;
}): Promise<{ report: Phase52RevenueOpsReport; error?: string }> {
  const empty = emptyPhase52RevenueOpsReport();
  if (!input.firmWide) {
    return { report: empty };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'get_marketing_revenue_phase52_ops_report',
    { p_days: input.days ?? 30 },
  );
  if (error) return { report: empty, error: error.message };
  const report = data as Phase52RevenueOpsReport | null;
  if (!report || report.version !== REVENUE_REPORT_VERSION_PHASE52) {
    return {
      report: empty,
      error: 'Phase 52 revenue ops report contract mismatch',
    };
  }
  return {
    report: {
      ...empty,
      ...report,
      pending_items: (report.pending_items ?? []).slice(0, 50),
      recent_digests: (report.recent_digests ?? []).slice(0, 50),
      alerts: (report.alerts ?? []).slice(0, 50),
      destination_key: report.destination_key || OPS_DESTINATION_KEY,
    },
  };
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Phase 52 ops ticks require service-role configuration');
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

function backlogThreshold(): number {
  const raw = Number(
    process.env.MARKETING_PHASE52_PENDING_DIGEST_BACKLOG_THRESHOLD ?? 5,
  );
  if (!Number.isFinite(raw)) return 5;
  return Math.min(Math.max(Math.trunc(raw), 1), 500);
}

type CriticalWindow = {
  alert_kind: string;
  digest_id?: string | null;
  window_key: string;
  severity: string;
  total_pending_count?: number;
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
 * Record a firm-wide pending-proposals digest for approvers after Phase 51
 * auto-propose soak. NEVER auto-approves money — visibility only; two
 * distinct humans must still approve every promotion via Phase 50.
 */
export async function runPhase52RevenueOpsTick(): Promise<
  | {
      ok: true;
      totalPending: number;
      awaitingFirst: number;
      awaitingSecond: number;
      digestsRecorded: number;
      alertsRecorded: number;
      delivered: number;
      alertsSkipped: number;
      alertsFailed: number;
    }
  | { ok: false; error: string }
> {
  try {
    const sb = serviceClient();

    // ONLY ever records digest visibility — NEVER calls
    // approve_marketing_dry_run_promote_phase50.
    const { data: digestResult, error: digestError } = await sb.rpc(
      'record_marketing_pending_proposals_digest_phase52',
      {
        p_metadata: {
          contract_version: REVENUE_REPORT_VERSION_PHASE52,
          never_auto_approves_money: true,
          never_auto_approves: true,
        },
      },
    );
    if (digestError) return { ok: false, error: digestError.message };
    const digest = digestResult as {
      disposition?: string;
      total_pending_count?: number;
      awaiting_first_approval_count?: number;
      awaiting_second_approval_count?: number;
    } | null;

    const { data: windows, error: windowError } = await sb.rpc(
      'list_marketing_revenue_phase52_critical_windows',
      {
        p_window_hours: alertCooldownHours(),
        p_backlog_threshold: backlogThreshold(),
      },
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
        kind: 'marketing_revenue_phase52_ops_alert',
        version: REVENUE_REPORT_VERSION_PHASE52,
        alert_kind: window.alert_kind,
        digest_id: window.digest_id ?? null,
        window_key: window.window_key,
        severity: window.severity ?? 'warning',
        destination_key: OPS_DESTINATION_KEY,
        metrics_sha256: window.metrics_sha256 ?? null,
      });

      const { data: recorded, error: recordError } = await sb.rpc(
        'record_marketing_revenue_phase52_ops_alert',
        {
          p_alert: {
            alert_kind: window.alert_kind,
            digest_id: window.digest_id ?? null,
            window_key: window.window_key,
            severity: window.severity ?? 'warning',
            destination_key: OPS_DESTINATION_KEY,
            delivery_status: delivery.delivery_status,
            response_code: delivery.response_code,
            metadata: {
              contract_version: REVENUE_REPORT_VERSION_PHASE52,
              never_auto_approves_money: true,
              never_auto_approves: true,
              total_pending_count: window.total_pending_count ?? null,
            },
          },
        },
      );
      if (recordError) return { ok: false, error: recordError.message };
      if ((recorded as { inserted?: boolean } | null)?.inserted) {
        alertsRecorded += 1;
        if (delivery.delivery_status === 'delivered') delivered += 1;
        else if (delivery.delivery_status === 'skipped_no_webhook')
          alertsSkipped += 1;
        else alertsFailed += 1;
      }
    }

    return {
      ok: true,
      totalPending: Number(digest?.total_pending_count ?? 0),
      awaitingFirst: Number(digest?.awaiting_first_approval_count ?? 0),
      awaitingSecond: Number(digest?.awaiting_second_approval_count ?? 0),
      digestsRecorded: digest?.disposition === 'recorded' ? 1 : 0,
      alertsRecorded,
      delivered,
      alertsSkipped,
      alertsFailed,
    };
  } catch (caught) {
    return {
      ok: false,
      error:
        caught instanceof Error ? caught.message : 'Phase 52 ops tick failed',
    };
  }
}
