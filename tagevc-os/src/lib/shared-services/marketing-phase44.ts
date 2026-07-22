import { createClient } from '@supabase/supabase-js';
import {
  REVENUE_REPORT_VERSION_PHASE44,
  type Phase44RevenueOpsReport,
} from '@/lib/shared-services/marketing-revenue-contracts';
import { webhookUrl } from '@/lib/shared-services/slo-delivery';
import { createPersistClient } from '@/lib/supabase/persist-client';

const OPS_DESTINATION_KEY = 'ops_alerts';

export function emptyPhase44RevenueOpsReport(): Phase44RevenueOpsReport {
  return {
    version: REVENUE_REPORT_VERSION_PHASE44,
    window_days: 30,
    correction_validation_health: 'unknown',
    conflict_open_count: 0,
    recon_health: 'unknown',
    alert_delivery: 'none',
    validations: [],
    conflicts: [],
    snapshots: [],
    alerts: [],
    destination_key: OPS_DESTINATION_KEY,
  };
}

export async function getPhase44RevenueOpsReport(input: {
  entityId: string | null;
  firmWide: boolean;
  days: 7 | 30 | 90;
}): Promise<{ report: Phase44RevenueOpsReport; error?: string }> {
  const empty = emptyPhase44RevenueOpsReport();
  if (!input.firmWide && !input.entityId) {
    return {
      report: empty,
      error: 'Entity-scoped Phase 44 ops report requires an entity',
    };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'get_marketing_revenue_phase44_ops_report',
    {
      p_entity_id: input.entityId,
      p_days: input.days,
    },
  );
  if (error) return { report: empty, error: error.message };
  const report = data as Phase44RevenueOpsReport | null;
  if (!report || report.version !== REVENUE_REPORT_VERSION_PHASE44) {
    return {
      report: empty,
      error: 'Phase 44 revenue ops report contract mismatch',
    };
  }
  return {
    report: {
      ...empty,
      ...report,
      validations: (report.validations ?? []).slice(0, 50),
      conflicts: (report.conflicts ?? []).slice(0, 50),
      snapshots: (report.snapshots ?? []).slice(0, 100),
      alerts: (report.alerts ?? []).slice(0, 50),
      destination_key: report.destination_key || OPS_DESTINATION_KEY,
    },
  };
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Phase 44 ops ticks require service-role configuration');
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

type CriticalWindow = {
  alert_kind: string;
  entity_id: string;
  source_id: string | null;
  window_key: string;
  severity: string;
  metrics_sha256?: string;
  validation_id?: string;
  validation_status?: string;
  conflict_id?: string;
  conflict_kind?: string;
  snapshot_id?: string;
  reconciliation_status?: string;
  late_records?: number | null;
  pending_count?: number | null;
  max_age_hours?: number | null;
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

export async function proposeResolveAttributionConflict(input: {
  conflictId: string;
  resolution: 'proposed' | 'approved' | 'rejected';
  reason: string;
  actorId: string;
}): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 500) {
    return { ok: false, error: 'Resolution reason must be 10-500 characters' };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'propose_resolve_marketing_attribution_conflict_phase44',
    {
      p_conflict_id: input.conflictId,
      p_resolution: input.resolution,
      p_reason: reason,
      p_actor: input.actorId,
    },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, result: data };
}

export async function runPhase44RevenueOpsTick(input: {
  entityId: string | null;
  days?: 7 | 30 | 90;
}): Promise<
  | {
      ok: true;
      validations: { passed: number; failed: number; auto_rejected: number };
      conflictsInserted: number;
      snapshotsRecorded: number;
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

    const { data: validationResult, error: validationError } = await sb.rpc(
      'validate_marketing_revenue_corrections_phase44',
    );
    if (validationError) return { ok: false, error: validationError.message };
    const validations = {
      passed: Number(
        (validationResult as { passed?: number } | null)?.passed ?? 0,
      ),
      failed: Number(
        (validationResult as { failed?: number } | null)?.failed ?? 0,
      ),
      auto_rejected: Number(
        (validationResult as { auto_rejected?: number } | null)
          ?.auto_rejected ?? 0,
      ),
    };

    const { data: conflictResult, error: conflictError } = await sb.rpc(
      'detect_marketing_revenue_attribution_conflicts_phase44',
      {
        p_entity_id: input.entityId,
        p_days: days,
      },
    );
    if (conflictError) return { ok: false, error: conflictError.message };
    const conflictsInserted = Number(
      (conflictResult as { conflicts_inserted?: number } | null)
        ?.conflicts_inserted ?? 0,
    );

    const { data: snapshotResult, error: snapshotError } = await sb.rpc(
      'record_marketing_revenue_reconciliation_snapshots_phase44',
      { p_entity_id: input.entityId },
    );
    if (snapshotError) return { ok: false, error: snapshotError.message };
    const snapshotsRecorded = Number(
      (snapshotResult as { snapshots_recorded?: number } | null)
        ?.snapshots_recorded ?? 0,
    );

    const { data: windows, error: windowError } = await sb.rpc(
      'list_marketing_revenue_phase44_critical_windows',
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
        kind: 'marketing_revenue_phase44_ops_alert',
        version: REVENUE_REPORT_VERSION_PHASE44,
        alert_kind: window.alert_kind,
        entity_id: window.entity_id,
        source_id: window.source_id,
        window_key: window.window_key,
        severity: 'critical',
        destination_key: OPS_DESTINATION_KEY,
        metrics_sha256: window.metrics_sha256 ?? null,
      });

      const { data: recorded, error: recordError } = await sb.rpc(
        'record_marketing_revenue_phase44_ops_alert',
        {
          p_alert: {
            alert_kind: window.alert_kind,
            entity_id: window.entity_id,
            source_id: window.source_id,
            window_key: window.window_key,
            destination_key: OPS_DESTINATION_KEY,
            delivery_status: delivery.delivery_status,
            response_code: delivery.response_code,
            metadata: {
              contract_version: REVENUE_REPORT_VERSION_PHASE44,
              validation_id: window.validation_id ?? null,
              validation_status: window.validation_status ?? null,
              conflict_id: window.conflict_id ?? null,
              conflict_kind: window.conflict_kind ?? null,
              snapshot_id: window.snapshot_id ?? null,
              reconciliation_status: window.reconciliation_status ?? null,
              late_records: window.late_records ?? null,
              pending_count: window.pending_count ?? null,
              max_age_hours: window.max_age_hours ?? null,
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
      validations,
      conflictsInserted,
      snapshotsRecorded,
      alertsRecorded,
      delivered,
      skipped,
      failed,
    };
  } catch (caught) {
    return {
      ok: false,
      error:
        caught instanceof Error ? caught.message : 'Phase 44 ops tick failed',
    };
  }
}
