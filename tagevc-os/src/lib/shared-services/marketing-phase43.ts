import { createClient } from '@supabase/supabase-js';
import {
  REVENUE_REPORT_VERSION_PHASE43,
  type Phase43RevenueOpsReport,
  type RevenueAuthenticityMode,
} from '@/lib/shared-services/marketing-revenue-contracts';
import { webhookUrl } from '@/lib/shared-services/slo-delivery';
import { createPersistClient } from '@/lib/supabase/persist-client';

const OPS_DESTINATION_KEY = 'ops_alerts';

export function emptyPhase43RevenueOpsReport(): Phase43RevenueOpsReport {
  return {
    version: REVENUE_REPORT_VERSION_PHASE43,
    window_days: 30,
    binding_health: 'unknown',
    alert_delivery: 'none',
    critical_alert_count: 0,
    bindings: [],
    alerts: [],
    destination_key: OPS_DESTINATION_KEY,
  };
}

export async function getPhase43RevenueOpsReport(input: {
  entityId: string | null;
  firmWide: boolean;
  days: 7 | 30 | 90;
}): Promise<{ report: Phase43RevenueOpsReport; error?: string }> {
  const empty = emptyPhase43RevenueOpsReport();
  if (!input.firmWide && !input.entityId) {
    return {
      report: empty,
      error: 'Entity-scoped Phase 43 ops report requires an entity',
    };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'get_marketing_revenue_phase43_ops_report',
    {
      p_entity_id: input.entityId,
      p_days: input.days,
    },
  );
  if (error) return { report: empty, error: error.message };
  const report = data as Phase43RevenueOpsReport | null;
  if (!report || report.version !== REVENUE_REPORT_VERSION_PHASE43) {
    return {
      report: empty,
      error: 'Phase 43 revenue ops report contract mismatch',
    };
  }
  return {
    report: {
      ...empty,
      ...report,
      bindings: (report.bindings ?? []).slice(0, 100),
      alerts: (report.alerts ?? []).slice(0, 50),
      destination_key: report.destination_key || OPS_DESTINATION_KEY,
    },
  };
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Phase 43 ops ticks require service-role configuration');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function requiresSignatureSecret(mode: RevenueAuthenticityMode | string): boolean {
  return (
    mode === 'hmac_sha256' ||
    mode === 'signed_headers_v1' ||
    mode === 'jwt_bearer_v1'
  );
}

function envPresent(name: string | null | undefined): boolean {
  if (!name) return false;
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0;
}

function alertCooldownHours(): number {
  const raw = Number(process.env.MARKETING_SLO_ALERT_COOLDOWN_HOURS ?? 24);
  if (!Number.isFinite(raw)) return 24;
  return Math.min(Math.max(Math.trunc(raw), 1), 168);
}

type BindingSource = {
  source_id: string;
  entity_id: string;
  ledger_profile: string | null;
  authenticity_mode: string;
  credential_env_name: string;
  signature_env_name: string | null;
};

type CriticalWindow = {
  alert_kind: string;
  entity_id: string;
  source_id: string | null;
  window_key: string;
  severity: string;
  metrics_sha256?: string;
  snapshot_id?: string;
  binding_id?: string;
  binding_status?: string;
  fail_rate?: number | null;
  probe_count?: number | null;
  overdue_rate?: number | null;
  late_rate?: number | null;
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

export async function runPhase43RevenueOpsTick(input: {
  entityId: string | null;
  days?: 7 | 30 | 90;
}): Promise<
  | {
      ok: true;
      bindingsRecorded: number;
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
    let sourceQuery = sb
      .from('os_marketing_revenue_sources')
      .select(
        'source_id,entity_id,ledger_profile,authenticity_mode,credential_env_name,signature_env_name',
      )
      .eq('ledger_profile', 'production_v1');
    if (input.entityId) {
      sourceQuery = sourceQuery.eq('entity_id', input.entityId);
    }
    const { data: sources, error: sourceError } = await sourceQuery.limit(200);
    if (sourceError) return { ok: false, error: sourceError.message };

    const bindings = ((sources ?? []) as BindingSource[]).map((source) => {
      const signatureRequired = requiresSignatureSecret(source.authenticity_mode);
      return {
        source_id: source.source_id,
        credential_env_name: source.credential_env_name,
        signature_env_name: source.signature_env_name,
        credential_env_present: envPresent(source.credential_env_name),
        signature_env_required: signatureRequired,
        signature_env_present: signatureRequired
          ? envPresent(source.signature_env_name)
          : null,
        metadata: {
          contract_version: REVENUE_REPORT_VERSION_PHASE43,
        },
      };
    });

    const { data: bindingResult, error: bindingError } = await sb.rpc(
      'record_marketing_revenue_credential_binding_health',
      { p_bindings: bindings },
    );
    if (bindingError) return { ok: false, error: bindingError.message };
    const bindingsRecorded = Number(
      (bindingResult as { bindings_recorded?: number } | null)
        ?.bindings_recorded ?? 0,
    );

    const { data: windows, error: windowError } = await sb.rpc(
      'list_marketing_revenue_phase43_critical_windows',
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
        kind: 'marketing_revenue_slo_ops_alert',
        version: REVENUE_REPORT_VERSION_PHASE43,
        alert_kind: window.alert_kind,
        entity_id: window.entity_id,
        source_id: window.source_id,
        window_key: window.window_key,
        severity: 'critical',
        destination_key: OPS_DESTINATION_KEY,
        metrics_sha256: window.metrics_sha256 ?? null,
      });

      const { data: recorded, error: recordError } = await sb.rpc(
        'record_marketing_revenue_phase43_ops_alert',
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
              contract_version: REVENUE_REPORT_VERSION_PHASE43,
              snapshot_id: window.snapshot_id ?? null,
              binding_id: window.binding_id ?? null,
              binding_status: window.binding_status ?? null,
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
      bindingsRecorded,
      alertsRecorded,
      delivered,
      skipped,
      failed,
    };
  } catch (caught) {
    return {
      ok: false,
      error:
        caught instanceof Error ? caught.message : 'Phase 43 ops tick failed',
    };
  }
}
