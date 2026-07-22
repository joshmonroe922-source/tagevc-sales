import { createClient } from '@supabase/supabase-js';
import {
  REVENUE_REPORT_VERSION_PHASE48,
  type Phase48RevenueOpsReport,
} from '@/lib/shared-services/marketing-revenue-contracts';
import { webhookUrl } from '@/lib/shared-services/slo-delivery';
import { createPersistClient } from '@/lib/supabase/persist-client';

const OPS_DESTINATION_KEY = 'ops_alerts';
const DEFAULT_AUTOPILOT_ACTOR = '00000000-0000-4000-8000-000000000048';

export function emptyPhase48RevenueOpsReport(): Phase48RevenueOpsReport {
  return {
    version: REVENUE_REPORT_VERSION_PHASE48,
    window_days: 30,
    autopilot_health: 'unknown',
    archive_health: 'unknown',
    cohort_performance_health: 'unknown',
    conflict_resolution_health: 'unknown',
    alert_delivery: 'none',
    autopilot_waiting_count: 0,
    autopilot_promoted_count: 0,
    autopilot_blocked_count: 0,
    archives_count: 0,
    open_aging_count: 0,
    pending_closure_count: 0,
    thresholds: {},
    autopilot_runs: [],
    conflict_archives: [],
    performance_snapshots: [],
    aging_conflicts: [],
    alerts: [],
    destination_key: OPS_DESTINATION_KEY,
  };
}

export async function getPhase48RevenueOpsReport(input: {
  entityId: string | null;
  firmWide: boolean;
  days: 7 | 30 | 90;
}): Promise<{ report: Phase48RevenueOpsReport; error?: string }> {
  const empty = emptyPhase48RevenueOpsReport();
  if (!input.firmWide && !input.entityId) {
    return {
      report: empty,
      error: 'Entity-scoped Phase 48 ops report requires an entity',
    };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'get_marketing_revenue_phase48_ops_report',
    {
      p_entity_id: input.entityId,
      p_days: input.days,
    },
  );
  if (error) return { report: empty, error: error.message };
  const report = data as Phase48RevenueOpsReport | null;
  if (!report || report.version !== REVENUE_REPORT_VERSION_PHASE48) {
    return {
      report: empty,
      error: 'Phase 48 revenue ops report contract mismatch',
    };
  }
  return {
    report: {
      ...empty,
      ...report,
      autopilot_runs: (report.autopilot_runs ?? []).slice(0, 50),
      conflict_archives: (report.conflict_archives ?? []).slice(0, 50),
      performance_snapshots: (report.performance_snapshots ?? []).slice(0, 100),
      aging_conflicts: (report.aging_conflicts ?? []).slice(0, 50),
      alerts: (report.alerts ?? []).slice(0, 50),
      destination_key: report.destination_key || OPS_DESTINATION_KEY,
    },
  };
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Phase 48 ops ticks require service-role configuration');
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

function autopilotActorId(): string {
  const raw = process.env.MARKETING_AUTOPILOT_ACTOR_ID?.trim();
  if (raw && /^[0-9a-f-]{36}$/i.test(raw)) return raw;
  return DEFAULT_AUTOPILOT_ACTOR;
}

type CriticalWindow = {
  alert_kind: string;
  entity_id: string;
  source_id: string | null;
  cohort_id?: string | null;
  archive_id?: string | null;
  window_key: string;
  severity: string;
  metrics_sha256?: string;
  snapshot_id?: string | null;
  promote_rate?: number | null;
  close_rate?: number | null;
  open_conflicts?: number | null;
  perf_severity?: string | null;
  run_id?: string | null;
  run_status?: string | null;
  consecutive_healthy_windows?: number | null;
  windows_required?: number | null;
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

export async function runPhase48RevenueOpsTick(input: {
  entityId: string | null;
  days?: 7 | 30 | 90;
}): Promise<
  | {
      ok: true;
      performanceSnapshots: number;
      archivesRecorded: number;
      autopilotRuns: number;
      autopilotPromoted: number;
      alertsRecorded: number;
      delivered: number;
      skipped: number;
      failed: number;
    }
  | { ok: false; error: string }
> {
  try {
    const sb = serviceClient();
    const days = input.days ?? 30;

    const { data: perfResult, error: perfError } = await sb.rpc(
      'record_marketing_cohort_performance_snapshot_phase48',
      {
        p_entity_id: input.entityId,
        p_days: days,
      },
    );
    if (perfError) return { ok: false, error: perfError.message };
    const performanceSnapshots = Number(
      (perfResult as { snapshots_recorded?: number } | null)
        ?.snapshots_recorded ?? 0,
    );

    const { data: archiveResult, error: archiveError } = await sb.rpc(
      'archive_marketing_closed_conflict_cohorts_phase48',
      {
        p_payload: {
          entity_id: input.entityId,
          days,
          archived_by: autopilotActorId(),
          metadata: { contract_version: REVENUE_REPORT_VERSION_PHASE48 },
        },
      },
    );
    if (archiveError) return { ok: false, error: archiveError.message };
    const archivesRecorded = Number(
      (archiveResult as { archives_recorded?: number } | null)
        ?.archives_recorded ?? 0,
    );

    const { data: autoResult, error: autoError } = await sb.rpc(
      'run_marketing_cohort_autopilot_phase48',
      {
        p_payload: {
          entity_id: input.entityId,
          created_by: autopilotActorId(),
          metadata: {
            contract_version: REVENUE_REPORT_VERSION_PHASE48,
            never_auto_approves_money: true,
          },
        },
      },
    );
    if (autoError) return { ok: false, error: autoError.message };
    const autopilotRuns = Number(
      (autoResult as { runs?: number } | null)?.runs ?? 0,
    );
    const autopilotPromoted = Number(
      (autoResult as { promoted?: number } | null)?.promoted ?? 0,
    );

    const { data: windows, error: windowError } = await sb.rpc(
      'list_marketing_revenue_phase48_critical_windows',
      {
        p_entity_id: input.entityId,
        p_days: days,
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
        kind: 'marketing_revenue_phase48_ops_alert',
        version: REVENUE_REPORT_VERSION_PHASE48,
        alert_kind: window.alert_kind,
        entity_id: window.entity_id,
        source_id: window.source_id,
        cohort_id: window.cohort_id ?? null,
        archive_id: window.archive_id ?? null,
        window_key: window.window_key,
        severity: 'critical',
        destination_key: OPS_DESTINATION_KEY,
        metrics_sha256: window.metrics_sha256 ?? null,
      });

      const { data: recorded, error: recordError } = await sb.rpc(
        'record_marketing_revenue_phase48_ops_alert',
        {
          p_alert: {
            alert_kind: window.alert_kind,
            entity_id: window.entity_id,
            source_id: window.source_id,
            cohort_id: window.cohort_id ?? null,
            archive_id: window.archive_id ?? null,
            window_key: window.window_key,
            destination_key: OPS_DESTINATION_KEY,
            delivery_status: delivery.delivery_status,
            response_code: delivery.response_code,
            metadata: {
              contract_version: REVENUE_REPORT_VERSION_PHASE48,
              snapshot_id: window.snapshot_id ?? null,
              promote_rate: window.promote_rate ?? null,
              close_rate: window.close_rate ?? null,
              open_conflicts: window.open_conflicts ?? null,
              perf_severity: window.perf_severity ?? null,
              run_id: window.run_id ?? null,
              run_status: window.run_status ?? null,
              consecutive_healthy_windows:
                window.consecutive_healthy_windows ?? null,
              windows_required: window.windows_required ?? null,
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
      performanceSnapshots,
      archivesRecorded,
      autopilotRuns,
      autopilotPromoted,
      alertsRecorded,
      delivered,
      skipped,
      failed,
    };
  } catch (caught) {
    return {
      ok: false,
      error:
        caught instanceof Error ? caught.message : 'Phase 48 ops tick failed',
    };
  }
}
