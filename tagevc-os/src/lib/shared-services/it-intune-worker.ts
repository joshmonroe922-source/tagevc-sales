import { createHash, randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  getMsGraphToken,
  graphConfigured,
} from '@/lib/shared-services/it-mdm';
import { webhookUrl } from '@/lib/shared-services/slo-delivery';

const INTUNE_OPS_DESTINATION_KEY = 'ops_alerts';

type ClaimedAction = {
  action_id: string;
  managed_device_id: string;
  status: string;
  lease_token: string;
  attempt_count: number;
  poll_count: number;
  requested_at: string;
  submitted_at: string | null;
  dispatch_started_at: string | null;
  local_asset_id: string | null;
  match_snapshot: { normalized_serial?: string } | null;
  approval_match_sha256: string | null;
  match_sha256: string | null;
  row_version: number;
  last_error_code: string | null;
};

export type IntuneProviderOutcome =
  | 'success'
  | 'failure'
  | 'ambiguous'
  | 'ignored';

export function classifyIntuneProviderOutcome(
  status: number,
  requestKind: 'preflight_read' | 'verification_read' | 'dispatch_post',
): IntuneProviderOutcome {
  if ([408, 425, 429].includes(status) || status >= 500) {
    return requestKind === 'dispatch_post' ? 'ambiguous' : 'failure';
  }
  if (status === 401 || status === 403) return 'ignored';
  if (status >= 200 && status <= 299) return 'success';
  if (requestKind !== 'dispatch_post' && status === 404) return 'success';
  return 'ignored';
}

type ClaimedHealthCanary = {
  canary_run_id: string;
  lease_token: string;
  row_version: number;
};

async function runReadOnlyHealthCanaryWithToken(token: string): Promise<{
  ok: boolean;
  status: string;
  error?: string;
}> {
  const sb = await createPersistClient();
  const workerId = `intune-health-${randomUUID()}`;
  const { error: enqueueError } = await sb.rpc(
    'enqueue_it_intune_health_canary',
    { p_run_key: randomUUID() },
  );
  if (enqueueError) {
    return { ok: false, status: 'enqueue_failed', error: enqueueError.message };
  }
  const { data, error: claimError } = await sb.rpc(
    'claim_it_intune_health_canary',
    { p_worker_id: workerId, p_lease_seconds: 60 },
  );
  if (claimError) {
    return { ok: false, status: 'claim_failed', error: claimError.message };
  }
  if (!data) return { ok: true, status: 'idle' };
  const run = data as ClaimedHealthCanary;
  let httpStatus: number | null = null;
  let errorCode: string | null = null;
  let graphRequestId: string | null = null;
  try {
    // Phase 40's canary is intentionally a tenant-level GET. It has no action,
    // dispatch attempt, authorization token, or route to the retire POST.
    const response = await fetch(
      'https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$top=1&$select=id',
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'client-request-id': run.canary_run_id,
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
    httpStatus = response.status;
    graphRequestId =
      response.headers.get('request-id') ||
      response.headers.get('client-request-id');
    errorCode =
      response.status === 429
        ? 'provider_throttled'
        : response.status >= 500
          ? 'provider_5xx'
          : [401, 403].includes(response.status)
            ? 'permission_denied'
            : null;
  } catch {
    errorCode = 'provider_transport';
  }
  const { data: finished, error: finishError } = await sb.rpc(
    'finish_it_intune_health_canary',
    {
      p_canary_run_id: run.canary_run_id,
      p_worker_id: workerId,
      p_lease_token: run.lease_token,
      p_expected_row_version: run.row_version,
      p_http_status: httpStatus,
      p_error_code: errorCode,
      p_graph_request_id: graphRequestId,
      p_evidence: {
        endpoint: 'managedDevices',
        request_method: 'GET',
        response_body_persisted: false,
      },
    },
  );
  if (finishError) {
    return { ok: false, status: 'finish_failed', error: finishError.message };
  }
  const { error: correlationError } = await sb.rpc(
    'correlate_it_intune_provider_outage',
  );
  if (correlationError) {
    return {
      ok: false,
      status: 'correlation_failed',
      error: correlationError.message,
    };
  }
  // Phase 41 follow-ups seed aggregate postmortems and bounded recommendation
  // drafts only. They never close, reset, or mutate breaker state.
  const { error: phase41Error } = await sb.rpc(
    'generate_it_intune_phase41_followups',
  );
  if (phase41Error) {
    return {
      ok: false,
      status: 'phase41_followups_failed',
      error: phase41Error.message,
    };
  }
  // Phase 42 soak observations after accepted recommendations. Read-only
  // against breaker state — never close or reset open breakers.
  const { error: phase42Error } = await sb.rpc(
    'observe_it_intune_recommendation_soak_phase42',
  );
  if (phase42Error) {
    return {
      ok: false,
      status: 'phase42_soak_failed',
      error: phase42Error.message,
    };
  }
  // Phase 43 records open→closed cycle evidence only when the breaker has
  // naturally returned to closed. Never close or reset from soak.
  const { error: phase43Error } = await sb.rpc(
    'record_it_intune_soak_cycle_evidence_phase43',
  );
  if (phase43Error) {
    return {
      ok: false,
      status: 'phase43_soak_cycle_failed',
      error: phase43Error.message,
    };
  }
  // Phase 44: performance snapshots → correlate → critical windows → webhook
  // → record alerts. Observe-only; never close or reset breakers.
  const phase44 = await runIntunePhase44ResilienceOpsTick(sb);
  if (!phase44.ok) {
    return {
      ok: false,
      status: 'phase44_resilience_ops_failed',
      error: phase44.error,
    };
  }
  // Phase 45: postmortem quality reviews → promote gate eval → alerts.
  // Observe-only; never close or reset breakers.
  const phase45 = await runIntunePhase45QualityGateOpsTick(sb);
  if (!phase45.ok) {
    return {
      ok: false,
      status: 'phase45_quality_gate_ops_failed',
      error: phase45.error,
    };
  }
  // Phase 46: deeper scorecards → promote gate/waive eval → alerts.
  // Observe-only; never close or reset breakers.
  const phase46 = await runIntunePhase46QualityWaiveOpsTick(sb);
  if (!phase46.ok) {
    return {
      ok: false,
      status: 'phase46_quality_waive_ops_failed',
      error: phase46.error,
    };
  }
  // Phase 47: MTTR correlation → waive expiry expire tick → alerts.
  // Observe-only; never close or reset breakers.
  const phase47 = await runIntunePhase47ExpiryMttrOpsTick(sb);
  if (!phase47.ok) {
    return {
      ok: false,
      status: 'phase47_expiry_mttr_ops_failed',
      error: phase47.error,
    };
  }
  // Phase 48: template suggestions → waive lifecycle → expired paging.
  // Observe-only; never close or reset breakers; never auto-publish.
  const phase48 = await runIntunePhase48TemplateLifecycleOpsTick(sb);
  if (!phase48.ok) {
    return {
      ok: false,
      status: 'phase48_template_lifecycle_ops_failed',
      error: phase48.error,
    };
  }
  return {
    ok: true,
    status: String((finished as { status?: string } | null)?.status ?? 'done'),
  };
}

export async function processReadOnlyIntuneHealthCanary(): Promise<{
  ok: boolean;
  status: string;
  error?: string;
}> {
  if (!graphConfigured()) {
    return { ok: false, status: 'not_configured', error: 'MS_GRAPH_* is not configured' };
  }
  const token = await getMsGraphToken();
  if (!token.ok) {
    return { ok: false, status: 'token_failed', error: token.detail };
  }
  return runReadOnlyHealthCanaryWithToken(token.token);
}

export async function processIntunePhase41Followups(): Promise<{
  ok: boolean;
  status: string;
  detail?: Record<string, unknown>;
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('generate_it_intune_phase41_followups');
  if (error) {
    return { ok: false, status: 'phase41_followups_failed', error: error.message };
  }
  return {
    ok: true,
    status: 'done',
    detail: (data as Record<string, unknown> | null) ?? undefined,
  };
}

export async function processIntunePhase42Soak(): Promise<{
  ok: boolean;
  status: string;
  detail?: Record<string, unknown>;
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'observe_it_intune_recommendation_soak_phase42',
  );
  if (error) {
    return { ok: false, status: 'phase42_soak_failed', error: error.message };
  }
  return {
    ok: true,
    status: 'done',
    detail: (data as Record<string, unknown> | null) ?? undefined,
  };
}

export async function processIntunePhase43SoakCycle(): Promise<{
  ok: boolean;
  status: string;
  detail?: Record<string, unknown>;
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'record_it_intune_soak_cycle_evidence_phase43',
  );
  if (error) {
    return {
      ok: false,
      status: 'phase43_soak_cycle_failed',
      error: error.message,
    };
  }
  return {
    ok: true,
    status: 'done',
    detail: (data as Record<string, unknown> | null) ?? undefined,
  };
}

type Phase44CriticalWindow = {
  alert_kind: string;
  window_key: string;
  severity?: string;
  breaker_id?: string | null;
};

async function deliverIntuneOpsWebhook(payload: Record<string, unknown>): Promise<{
  delivery_status: 'delivered' | 'skipped_no_webhook' | 'failed';
  response_code: number | null;
}> {
  const url = webhookUrl(INTUNE_OPS_DESTINATION_KEY);
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

async function runIntunePhase44ResilienceOpsTick(
  sb: Awaited<ReturnType<typeof createPersistClient>>,
): Promise<
  | {
      ok: true;
      snapshotsRecorded: number;
      alertsRecorded: number;
      delivered: number;
      skipped: number;
      failed: number;
    }
  | { ok: false; error: string }
> {
  const { data: snapshotData, error: snapshotError } = await sb.rpc(
    'snapshot_it_intune_breaker_performance_phase44',
  );
  if (snapshotError) {
    return { ok: false, error: snapshotError.message };
  }

  // Optional enrichment — returns timeline jsonb; never mutates breakers.
  const { error: correlateError } = await sb.rpc(
    'correlate_it_intune_resilience_phase44',
  );
  if (correlateError) {
    return { ok: false, error: correlateError.message };
  }

  const { data: windows, error: windowError } = await sb.rpc(
    'list_it_intune_phase44_critical_windows',
    { p_window_hours: 24 },
  );
  if (windowError) {
    return { ok: false, error: windowError.message };
  }

  const pending = ((windows as { pending?: Phase44CriticalWindow[] } | null)
    ?.pending ?? []) as Phase44CriticalWindow[];
  let alertsRecorded = 0;
  let delivered = 0;
  let skipped = 0;
  let failed = 0;

  for (const window of pending.slice(0, 50)) {
    const delivery = await deliverIntuneOpsWebhook({
      kind: 'it_intune_phase44_ops_alert',
      version: 'phase44-v1',
      alert_kind: window.alert_kind,
      window_key: window.window_key,
      severity: window.severity ?? 'critical',
      breaker_id: window.breaker_id ?? null,
      destination_key: INTUNE_OPS_DESTINATION_KEY,
      entity_identifiers_included: false,
      closes_or_resets_breaker: false,
    });

    const { data: recorded, error: recordError } = await sb.rpc(
      'record_it_intune_phase44_ops_alert',
      {
        p_alert: {
          alert_kind: window.alert_kind,
          window_key: window.window_key,
          severity: window.severity ?? 'critical',
          breaker_id: window.breaker_id ?? null,
          destination_key: INTUNE_OPS_DESTINATION_KEY,
          delivery_status: delivery.delivery_status,
          response_code: delivery.response_code,
          aggregate_evidence: {
            evidence_version: 'phase44-v1',
            entity_identifiers_included: false,
            closes_or_resets_breaker: false,
          },
        },
      },
    );
    if (recordError) {
      return { ok: false, error: recordError.message };
    }
    if ((recorded as { inserted?: boolean } | null)?.inserted) {
      alertsRecorded += 1;
      if (delivery.delivery_status === 'delivered') delivered += 1;
      else if (delivery.delivery_status === 'skipped_no_webhook') skipped += 1;
      else failed += 1;
    }
  }

  return {
    ok: true,
    snapshotsRecorded: Number(
      (snapshotData as { snapshots_recorded?: number } | null)
        ?.snapshots_recorded ?? 0,
    ),
    alertsRecorded,
    delivered,
    skipped,
    failed,
  };
}

export async function processIntunePhase44ResilienceOps(): Promise<{
  ok: boolean;
  status: string;
  detail?: Record<string, unknown>;
  error?: string;
}> {
  const sb = await createPersistClient();
  const result = await runIntunePhase44ResilienceOpsTick(sb);
  if (!result.ok) {
    return {
      ok: false,
      status: 'phase44_resilience_ops_failed',
      error: result.error,
    };
  }
  return {
    ok: true,
    status: 'done',
    detail: {
      snapshots_recorded: result.snapshotsRecorded,
      alerts_recorded: result.alertsRecorded,
      delivered: result.delivered,
      skipped: result.skipped,
      failed: result.failed,
      closes_or_resets_breaker: false,
    },
  };
}

type Phase45CriticalWindow = {
  alert_kind: string;
  window_key: string;
  severity?: string;
  recommendation_id?: string | null;
  proposal_id?: string | null;
  postmortem_id?: string | null;
};

async function runIntunePhase45QualityGateOpsTick(
  sb: Awaited<ReturnType<typeof createPersistClient>>,
): Promise<
  | {
      ok: true;
      reviewsRecorded: number;
      gatesRecorded: number;
      alertsRecorded: number;
      delivered: number;
      skipped: number;
      failed: number;
    }
  | { ok: false; error: string }
> {
  const { data: reviewData, error: reviewError } = await sb.rpc(
    'review_it_intune_postmortem_quality_phase45',
  );
  if (reviewError) {
    return { ok: false, error: reviewError.message };
  }

  const { data: gateData, error: gateError } = await sb.rpc(
    'evaluate_it_intune_tuning_promote_gate_phase45',
  );
  if (gateError) {
    return { ok: false, error: gateError.message };
  }

  const { data: windows, error: windowError } = await sb.rpc(
    'list_it_intune_phase45_critical_windows',
    { p_window_hours: 24 },
  );
  if (windowError) {
    return { ok: false, error: windowError.message };
  }

  const pending = ((windows as { pending?: Phase45CriticalWindow[] } | null)
    ?.pending ?? []) as Phase45CriticalWindow[];
  let alertsRecorded = 0;
  let delivered = 0;
  let skipped = 0;
  let failed = 0;

  for (const window of pending.slice(0, 50)) {
    const delivery = await deliverIntuneOpsWebhook({
      kind: 'it_intune_phase45_ops_alert',
      version: 'phase45-v1',
      alert_kind: window.alert_kind,
      window_key: window.window_key,
      severity: window.severity ?? 'warning',
      recommendation_id: window.recommendation_id ?? null,
      proposal_id: window.proposal_id ?? null,
      postmortem_id: window.postmortem_id ?? null,
      destination_key: INTUNE_OPS_DESTINATION_KEY,
      entity_identifiers_included: false,
      closes_or_resets_breaker: false,
    });

    const { data: recorded, error: recordError } = await sb.rpc(
      'record_it_intune_phase45_ops_alert',
      {
        p_alert: {
          alert_kind: window.alert_kind,
          window_key: window.window_key,
          severity: window.severity ?? 'warning',
          recommendation_id: window.recommendation_id ?? null,
          proposal_id: window.proposal_id ?? null,
          postmortem_id: window.postmortem_id ?? null,
          destination_key: INTUNE_OPS_DESTINATION_KEY,
          delivery_status: delivery.delivery_status,
          response_code: delivery.response_code,
          aggregate_evidence: {
            evidence_version: 'phase45-v1',
            entity_identifiers_included: false,
            closes_or_resets_breaker: false,
          },
        },
      },
    );
    if (recordError) {
      return { ok: false, error: recordError.message };
    }
    if ((recorded as { inserted?: boolean } | null)?.inserted) {
      alertsRecorded += 1;
      if (delivery.delivery_status === 'delivered') delivered += 1;
      else if (delivery.delivery_status === 'skipped_no_webhook') skipped += 1;
      else failed += 1;
    }
  }

  return {
    ok: true,
    reviewsRecorded: Number(
      (reviewData as { reviews_recorded?: number } | null)?.reviews_recorded ??
        0,
    ),
    gatesRecorded: Number(
      (gateData as { gates_recorded?: number } | null)?.gates_recorded ?? 0,
    ),
    alertsRecorded,
    delivered,
    skipped,
    failed,
  };
}

export async function processIntunePhase45QualityGateOps(): Promise<{
  ok: boolean;
  status: string;
  detail?: Record<string, unknown>;
  error?: string;
}> {
  const sb = await createPersistClient();
  const result = await runIntunePhase45QualityGateOpsTick(sb);
  if (!result.ok) {
    return {
      ok: false,
      status: 'phase45_quality_gate_ops_failed',
      error: result.error,
    };
  }
  return {
    ok: true,
    status: 'done',
    detail: {
      reviews_recorded: result.reviewsRecorded,
      gates_recorded: result.gatesRecorded,
      alerts_recorded: result.alertsRecorded,
      delivered: result.delivered,
      skipped: result.skipped,
      failed: result.failed,
      closes_or_resets_breaker: false,
    },
  };
}

type Phase46CriticalWindow = {
  alert_kind: string;
  window_key: string;
  severity?: string;
  recommendation_id?: string | null;
  waive_proposal_id?: string | null;
  postmortem_id?: string | null;
};

async function runIntunePhase46QualityWaiveOpsTick(
  sb: Awaited<ReturnType<typeof createPersistClient>>,
): Promise<
  | {
      ok: true;
      scorecardsRecorded: number;
      gatesRecorded: number;
      alertsRecorded: number;
      delivered: number;
      skipped: number;
      failed: number;
    }
  | { ok: false; error: string }
> {
  const { data: scoreData, error: scoreError } = await sb.rpc(
    'score_it_intune_postmortem_quality_phase46',
  );
  if (scoreError) {
    return { ok: false, error: scoreError.message };
  }

  const { data: gateData, error: gateError } = await sb.rpc(
    'evaluate_it_intune_tuning_promote_gate_phase46',
  );
  if (gateError) {
    return { ok: false, error: gateError.message };
  }

  const { data: windows, error: windowError } = await sb.rpc(
    'list_it_intune_phase46_critical_windows',
    { p_window_hours: 24 },
  );
  if (windowError) {
    return { ok: false, error: windowError.message };
  }

  const pending = ((windows as { pending?: Phase46CriticalWindow[] } | null)
    ?.pending ?? []) as Phase46CriticalWindow[];
  let alertsRecorded = 0;
  let delivered = 0;
  let skipped = 0;
  let failed = 0;

  for (const window of pending.slice(0, 50)) {
    const delivery = await deliverIntuneOpsWebhook({
      kind: 'it_intune_phase46_ops_alert',
      version: 'phase46-v1',
      alert_kind: window.alert_kind,
      window_key: window.window_key,
      severity: window.severity ?? 'warning',
      recommendation_id: window.recommendation_id ?? null,
      waive_proposal_id: window.waive_proposal_id ?? null,
      postmortem_id: window.postmortem_id ?? null,
      destination_key: INTUNE_OPS_DESTINATION_KEY,
      entity_identifiers_included: false,
      closes_or_resets_breaker: false,
    });

    const { data: recorded, error: recordError } = await sb.rpc(
      'record_it_intune_phase46_ops_alert',
      {
        p_alert: {
          alert_kind: window.alert_kind,
          window_key: window.window_key,
          severity: window.severity ?? 'warning',
          recommendation_id: window.recommendation_id ?? null,
          waive_proposal_id: window.waive_proposal_id ?? null,
          postmortem_id: window.postmortem_id ?? null,
          destination_key: INTUNE_OPS_DESTINATION_KEY,
          delivery_status: delivery.delivery_status,
          response_code: delivery.response_code,
          aggregate_evidence: {
            evidence_version: 'phase46-v1',
            entity_identifiers_included: false,
            closes_or_resets_breaker: false,
          },
        },
      },
    );
    if (recordError) {
      return { ok: false, error: recordError.message };
    }
    if ((recorded as { inserted?: boolean } | null)?.inserted) {
      alertsRecorded += 1;
      if (delivery.delivery_status === 'delivered') delivered += 1;
      else if (delivery.delivery_status === 'skipped_no_webhook') skipped += 1;
      else failed += 1;
    }
  }

  return {
    ok: true,
    scorecardsRecorded: Number(
      (scoreData as { scorecards_recorded?: number } | null)
        ?.scorecards_recorded ?? 0,
    ),
    gatesRecorded: Number(
      (gateData as { gates_recorded?: number } | null)?.gates_recorded ?? 0,
    ),
    alertsRecorded,
    delivered,
    skipped,
    failed,
  };
}

export async function processIntunePhase46QualityWaiveOps(): Promise<{
  ok: boolean;
  status: string;
  detail?: Record<string, unknown>;
  error?: string;
}> {
  const sb = await createPersistClient();
  const result = await runIntunePhase46QualityWaiveOpsTick(sb);
  if (!result.ok) {
    return {
      ok: false,
      status: 'phase46_quality_waive_ops_failed',
      error: result.error,
    };
  }
  return {
    ok: true,
    status: 'done',
    detail: {
      scorecards_recorded: result.scorecardsRecorded,
      gates_recorded: result.gatesRecorded,
      alerts_recorded: result.alertsRecorded,
      delivered: result.delivered,
      skipped: result.skipped,
      failed: result.failed,
      closes_or_resets_breaker: false,
    },
  };
}

type Phase47CriticalWindow = {
  alert_kind: string;
  window_key: string;
  severity?: string;
  recommendation_id?: string | null;
  waive_proposal_id?: string | null;
  expiry_proposal_id?: string | null;
  postmortem_id?: string | null;
  scorecard_id?: string | null;
};

async function runIntunePhase47ExpiryMttrOpsTick(
  sb: Awaited<ReturnType<typeof createPersistClient>>,
): Promise<
  | {
      ok: true;
      correlationsRecorded: number;
      expiredCount: number;
      alertsRecorded: number;
      delivered: number;
      skipped: number;
      failed: number;
    }
  | { ok: false; error: string }
> {
  const { data: corrData, error: corrError } = await sb.rpc(
    'correlate_it_intune_scorecard_mttr_phase47',
  );
  if (corrError) {
    return { ok: false, error: corrError.message };
  }

  const { data: expireData, error: expireError } = await sb.rpc(
    'expire_it_intune_promote_waive_approved_phase47',
  );
  if (expireError) {
    return { ok: false, error: expireError.message };
  }

  const { data: windows, error: windowError } = await sb.rpc(
    'list_it_intune_phase47_critical_windows',
    { p_window_hours: 24 },
  );
  if (windowError) {
    return { ok: false, error: windowError.message };
  }

  const pending = ((windows as { pending?: Phase47CriticalWindow[] } | null)
    ?.pending ?? []) as Phase47CriticalWindow[];
  let alertsRecorded = 0;
  let delivered = 0;
  let skipped = 0;
  let failed = 0;

  for (const window of pending.slice(0, 50)) {
    const delivery = await deliverIntuneOpsWebhook({
      kind: 'it_intune_phase47_ops_alert',
      version: 'phase47-v1',
      alert_kind: window.alert_kind,
      window_key: window.window_key,
      severity: window.severity ?? 'warning',
      recommendation_id: window.recommendation_id ?? null,
      waive_proposal_id: window.waive_proposal_id ?? null,
      expiry_proposal_id: window.expiry_proposal_id ?? null,
      postmortem_id: window.postmortem_id ?? null,
      scorecard_id: window.scorecard_id ?? null,
      destination_key: INTUNE_OPS_DESTINATION_KEY,
      entity_identifiers_included: false,
      closes_or_resets_breaker: false,
    });

    const { data: recorded, error: recordError } = await sb.rpc(
      'record_it_intune_phase47_ops_alert',
      {
        p_alert: {
          alert_kind: window.alert_kind,
          window_key: window.window_key,
          severity: window.severity ?? 'warning',
          recommendation_id: window.recommendation_id ?? null,
          waive_proposal_id: window.waive_proposal_id ?? null,
          expiry_proposal_id: window.expiry_proposal_id ?? null,
          postmortem_id: window.postmortem_id ?? null,
          scorecard_id: window.scorecard_id ?? null,
          destination_key: INTUNE_OPS_DESTINATION_KEY,
          delivery_status: delivery.delivery_status,
          response_code: delivery.response_code,
          aggregate_evidence: {
            evidence_version: 'phase47-v1',
            entity_identifiers_included: false,
            closes_or_resets_breaker: false,
          },
        },
      },
    );
    if (recordError) {
      return { ok: false, error: recordError.message };
    }
    if ((recorded as { inserted?: boolean } | null)?.inserted) {
      alertsRecorded += 1;
      if (delivery.delivery_status === 'delivered') delivered += 1;
      else if (delivery.delivery_status === 'skipped_no_webhook') skipped += 1;
      else failed += 1;
    }
  }

  return {
    ok: true,
    correlationsRecorded: Number(
      (corrData as { correlations_recorded?: number } | null)
        ?.correlations_recorded ?? 0,
    ),
    expiredCount: Number(expireData ?? 0),
    alertsRecorded,
    delivered,
    skipped,
    failed,
  };
}

export async function processIntunePhase47ExpiryMttrOps(): Promise<{
  ok: boolean;
  status: string;
  detail?: Record<string, unknown>;
  error?: string;
}> {
  const sb = await createPersistClient();
  const result = await runIntunePhase47ExpiryMttrOpsTick(sb);
  if (!result.ok) {
    return {
      ok: false,
      status: 'phase47_expiry_mttr_ops_failed',
      error: result.error,
    };
  }
  return {
    ok: true,
    status: 'done',
    detail: {
      correlations_recorded: result.correlationsRecorded,
      expired_count: result.expiredCount,
      alerts_recorded: result.alertsRecorded,
      delivered: result.delivered,
      skipped: result.skipped,
      failed: result.failed,
      closes_or_resets_breaker: false,
    },
  };
}

type Phase48CriticalWindow = {
  alert_kind: string;
  window_key: string;
  severity?: string;
  recommendation_id?: string | null;
  waive_proposal_id?: string | null;
  postmortem_id?: string | null;
  suggestion_id?: string | null;
  snapshot_id?: string | null;
};

async function runIntunePhase48TemplateLifecycleOpsTick(
  sb: Awaited<ReturnType<typeof createPersistClient>>,
): Promise<
  | {
      ok: true;
      suggestionsRecorded: number;
      lifecycleInserted: boolean;
      alertsRecorded: number;
      delivered: number;
      skipped: number;
      failed: number;
      pagesDelivered: number;
    }
  | { ok: false; error: string }
> {
  const { data: suggestData, error: suggestError } = await sb.rpc(
    'suggest_it_intune_postmortem_template_phase48',
  );
  if (suggestError) {
    return { ok: false, error: suggestError.message };
  }

  const { data: lifeData, error: lifeError } = await sb.rpc(
    'record_it_intune_waive_lifecycle_snapshot_phase48',
  );
  if (lifeError) {
    return { ok: false, error: lifeError.message };
  }

  const { data: windows, error: windowError } = await sb.rpc(
    'list_it_intune_phase48_critical_windows',
    { p_window_hours: 24 },
  );
  if (windowError) {
    return { ok: false, error: windowError.message };
  }

  const pending = ((windows as { pending?: Phase48CriticalWindow[] } | null)
    ?.pending ?? []) as Phase48CriticalWindow[];
  let alertsRecorded = 0;
  let delivered = 0;
  let skipped = 0;
  let failed = 0;
  let pagesDelivered = 0;

  for (const window of pending.slice(0, 50)) {
    const delivery = await deliverIntuneOpsWebhook({
      kind: 'it_intune_phase48_ops_alert',
      version: 'phase48-v1',
      alert_kind: window.alert_kind,
      window_key: window.window_key,
      severity: window.severity ?? 'warning',
      recommendation_id: window.recommendation_id ?? null,
      waive_proposal_id: window.waive_proposal_id ?? null,
      postmortem_id: window.postmortem_id ?? null,
      suggestion_id: window.suggestion_id ?? null,
      snapshot_id: window.snapshot_id ?? null,
      destination_key: INTUNE_OPS_DESTINATION_KEY,
      entity_identifiers_included: false,
      closes_or_resets_breaker: false,
      auto_publish: false,
    });

    const { data: recorded, error: recordError } = await sb.rpc(
      'record_it_intune_phase48_ops_alert',
      {
        p_alert: {
          alert_kind: window.alert_kind,
          window_key: window.window_key,
          severity: window.severity ?? 'warning',
          recommendation_id: window.recommendation_id ?? null,
          waive_proposal_id: window.waive_proposal_id ?? null,
          postmortem_id: window.postmortem_id ?? null,
          suggestion_id: window.suggestion_id ?? null,
          snapshot_id: window.snapshot_id ?? null,
          destination_key: INTUNE_OPS_DESTINATION_KEY,
          delivery_status: delivery.delivery_status,
          response_code: delivery.response_code,
          aggregate_evidence: {
            evidence_version: 'phase48-v1',
            entity_identifiers_included: false,
            closes_or_resets_breaker: false,
            auto_publish: false,
          },
        },
      },
    );
    if (recordError) {
      return { ok: false, error: recordError.message };
    }
    if ((recorded as { inserted?: boolean } | null)?.inserted) {
      alertsRecorded += 1;
      if (delivery.delivery_status === 'delivered') {
        delivered += 1;
        if (window.alert_kind === 'waive_expired_page') pagesDelivered += 1;
      } else if (delivery.delivery_status === 'skipped_no_webhook') {
        skipped += 1;
      } else {
        failed += 1;
      }
    }
  }

  return {
    ok: true,
    suggestionsRecorded: Number(
      (suggestData as { suggestions_recorded?: number } | null)
        ?.suggestions_recorded ?? 0,
    ),
    lifecycleInserted: Boolean(
      (lifeData as { inserted?: boolean } | null)?.inserted,
    ),
    alertsRecorded,
    delivered,
    skipped,
    failed,
    pagesDelivered,
  };
}

export async function processIntunePhase48TemplateLifecycleOps(): Promise<{
  ok: boolean;
  status: string;
  detail?: Record<string, unknown>;
  error?: string;
}> {
  const sb = await createPersistClient();
  const result = await runIntunePhase48TemplateLifecycleOpsTick(sb);
  if (!result.ok) {
    return {
      ok: false,
      status: 'phase48_template_lifecycle_ops_failed',
      error: result.error,
    };
  }
  return {
    ok: true,
    status: 'done',
    detail: {
      suggestions_recorded: result.suggestionsRecorded,
      lifecycle_inserted: result.lifecycleInserted,
      alerts_recorded: result.alertsRecorded,
      delivered: result.delivered,
      skipped: result.skipped,
      failed: result.failed,
      pages_delivered: result.pagesDelivered,
      closes_or_resets_breaker: false,
      auto_publish: false,
    },
  };
}

export async function processIntuneActions(): Promise<{
  ok: boolean;
  claimed: number;
  processed: Array<{ action_id: string; status: string; detail: string }>;
  error?: string;
}> {
  const sb = await createPersistClient();
  const workerId = `intune-${randomUUID()}`;
  const { error: expiryError } = await sb.rpc(
    'expire_it_intune_actions_v3',
    { p_limit: 100 },
  );
  if (expiryError) {
    return {
      ok: false,
      claimed: 0,
      processed: [],
      error: `Approval expiry sweep failed: ${expiryError.message}`,
    };
  }
  await sb
    .from('os_it_intune_worker_runs')
    .update({
      status: 'failed',
      platform_error: 'Worker run did not finalize before stale timeout',
      completed_at: new Date().toISOString(),
    })
    .eq('status', 'running')
    .lt(
      'started_at',
      new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    );
  const { data: workerRun, error: workerRunError } = await sb
    .from('os_it_intune_worker_runs')
    .insert({
      worker_id: workerId,
      trigger_source: 'worker',
      status: 'running',
    })
    .select('worker_run_id')
    .single();
  if (workerRunError || !workerRun) {
    return {
      ok: false,
      claimed: 0,
      processed: [],
      error:
        workerRunError?.message || 'Could not persist Intune worker run',
    };
  }
  const { error: canaryRecoveryError } = await sb.rpc(
    'recover_stale_it_intune_breaker_canaries',
  );
  if (canaryRecoveryError) {
    await sb
      .from('os_it_intune_worker_runs')
      .update({
        status: 'failed',
        platform_error: `Canary recovery failed: ${canaryRecoveryError.message}`,
        completed_at: new Date().toISOString(),
      })
      .eq('worker_run_id', workerRun.worker_run_id);
    return {
      ok: false,
      claimed: 0,
      processed: [],
      error: `Canary recovery failed: ${canaryRecoveryError.message}`,
    };
  }
  if (!graphConfigured()) {
    if (workerRun) {
      await sb.from('os_it_intune_worker_runs').update({
        status: 'failed',
        platform_error: 'MS_GRAPH_* is not configured',
        completed_at: new Date().toISOString(),
      }).eq('worker_run_id', workerRun.worker_run_id);
    }
    return {
      ok: false,
      claimed: 0,
      processed: [],
      error: 'MS_GRAPH_* is not configured',
    };
  }
  const token = await getMsGraphToken();
  if (!token.ok) {
    if (workerRun) {
      await sb.from('os_it_intune_worker_runs').update({
        status: 'failed',
        platform_error: token.detail,
        completed_at: new Date().toISOString(),
      }).eq('worker_run_id', workerRun.worker_run_id);
    }
    return { ok: false, claimed: 0, processed: [], error: token.detail };
  }
  // Health visibility is best-effort and independent from destructive dispatch.
  // Its failures are persisted/alerted but never grant or deny a POST.
  await runReadOnlyHealthCanaryWithToken(token.token);
  const { data, error } = await sb.rpc('claim_it_intune_action_v4', {
    p_worker_id: workerId,
    p_lease_seconds: 120,
  });
  if (error) {
    if (workerRun) {
      await sb
        .from('os_it_intune_worker_runs')
        .update({
          status: 'failed',
          platform_error: error.message,
          completed_at: new Date().toISOString(),
        })
        .eq('worker_run_id', workerRun.worker_run_id);
    }
    return { ok: false, claimed: 0, processed: [], error: error.message };
  }
  const actions = data ? [data as ClaimedAction] : [];
  const processed: Array<{
    action_id: string;
    status: string;
    detail: string;
  }> = [];
  let preflighted = 0;
  let authorizedCount = 0;
  let ambiguousCount = 0;
  let recoveredCount = 0;
  const headers = {
    Authorization: `Bearer ${token.token}`,
    'Content-Type': 'application/json',
  };
  for (const action of actions) {
    if (action.last_error_code === 'authorized_worker_recovered') {
      recoveredCount += 1;
    }
    let nextStatus = 'verifying';
    let detail = '';
    let evidence: Record<string, unknown> = {};
    let verificationCode: string | null = null;
    let graphRequestId: string | null = null;
    let errorMessage: string | null = null;
    let errorCode: string | null = null;
    let errorClass: 'transient' | 'ambiguous' | 'permanent' | 'platform' | null =
      null;
    let retryAfterSeconds: number | null = null;
    let providerPostStarted = false;
    let dispatchAuthorized = false;
    let dispatchAttemptId: string | null = null;
    let authorizationToken: string | null = null;
    let canaryToken: string | null = null;
    let finishRowVersion = action.row_version;
    let activeRequestKind:
      | 'preflight_read'
      | 'verification_read'
      | 'dispatch_post'
      | null = null;
    let activeObservationKey: string | null = null;
    const recordObservation = async (input: {
      requestKind: 'preflight_read' | 'verification_read' | 'dispatch_post';
      observationKey: string;
      httpStatus?: number | null;
      observationErrorCode?: string | null;
      requestId?: string | null;
      observationEvidence?: Record<string, unknown>;
    }) => {
      let observationError: { message: string } | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await sb.rpc(
          'record_it_intune_provider_observation',
          {
            p_action_id: action.action_id,
            p_worker_id: workerId,
            p_observation_key: input.observationKey,
            p_request_kind: input.requestKind,
            p_http_status: input.httpStatus ?? null,
            p_error_code: input.observationErrorCode ?? null,
            p_graph_request_id: input.requestId ?? null,
            p_dispatch_attempt_id: dispatchAttemptId,
            p_evidence: input.observationEvidence ?? {},
          },
        );
        observationError = response.error;
        if (!observationError) return;
      }
      if (observationError) {
        throw new Error(
          `Provider outcome persistence failed: ${observationError.message}`,
        );
      }
    };
    try {
      if (action.status === 'preflighting') {
        preflighted += 1;
        activeRequestKind = 'preflight_read';
        activeObservationKey = randomUUID();
        const preflight = await fetch(
          `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/${encodeURIComponent(action.managed_device_id)}?$select=id,serialNumber,managementState,deviceName,model`,
          { headers, signal: AbortSignal.timeout(20_000) },
        );
        const device = (await preflight.json().catch(() => ({}))) as {
          id?: string;
          serialNumber?: string;
          managementState?: string;
          deviceName?: string;
          model?: string;
        };
        const liveSerial = String(device.serialNumber ?? '')
          .replace(/[^a-z0-9]/gi, '')
          .toUpperCase();
        const approvedSerial = String(
          action.match_snapshot?.normalized_serial ?? '',
        );
        await recordObservation({
          requestKind: 'preflight_read',
          observationKey: activeObservationKey,
          httpStatus: preflight.status,
          observationErrorCode:
            preflight.status === 429
              ? 'provider_throttled'
              : preflight.status >= 500
                ? 'provider_5xx'
                : [401, 403].includes(preflight.status)
                  ? 'permission_denied'
                  : null,
          requestId:
            preflight.headers.get('request-id') ||
            preflight.headers.get('client-request-id'),
          observationEvidence: { provider_post_started: false },
        });
        activeRequestKind = null;
        activeObservationKey = null;
        if (
          !preflight.ok ||
          device.id !== action.managed_device_id ||
          !approvedSerial ||
          liveSerial !== approvedSerial ||
          action.approval_match_sha256 !== action.match_sha256
        ) {
          nextStatus =
            preflight.status === 401 ||
            preflight.status === 403 ||
            preflight.status === 429 ||
            preflight.status >= 500
              ? 'approved'
              : 'failed';
          verificationCode =
            preflight.status === 404
              ? 'provider_missing_before_dispatch'
              : preflight.status === 401 || preflight.status === 403
                ? 'permission_denied'
                : preflight.status === 429
                  ? 'provider_throttled'
                  : preflight.status >= 500
                    ? 'provider_5xx_ambiguous'
                    : 'asset_provider_mismatch';
          errorCode = verificationCode;
          errorClass =
            preflight.status === 401 || preflight.status === 403
              ? 'platform'
              : preflight.status === 429
                ? 'transient'
                : preflight.status >= 500
                  ? 'ambiguous'
                  : 'permanent';
          errorMessage =
            preflight.status === 404
              ? 'Managed device disappeared before dispatch'
              : preflight.status === 401 || preflight.status === 403
                ? 'Graph authorization failed before dispatch'
                : preflight.status === 429
                  ? 'Graph throttled identity preflight'
                  : preflight.status >= 500
                    ? `Graph identity preflight HTTP ${preflight.status}`
                    : 'Live provider identity no longer matches approved asset';
          if (preflight.status === 429) {
            retryAfterSeconds = Number(
              preflight.headers.get('retry-after') ?? 300,
            );
          }
          evidence = {
            http_status: preflight.status,
            provider_state: device.managementState ?? null,
            failure_code: verificationCode,
            live_serial_suffix: liveSerial.slice(-4),
            approved_serial_suffix: approvedSerial.slice(-4),
            provider_post_started: false,
          };
          detail = errorMessage;
        } else if (
          String(device.managementState ?? '').toLowerCase() === 'retired'
        ) {
          nextStatus = 'verified';
          verificationCode = 'management_state_retired';
          evidence = {
            http_status: preflight.status,
            provider_state: 'retired',
            identity_preflight: true,
          };
          detail = 'Provider already reports matching device retired';
        } else {
        const observedAt = new Date().toISOString();
        const providerPreflight = {
          managed_device_id: device.id,
          serial_number: device.serialNumber ?? '',
          management_state: device.managementState ?? null,
          device_name: device.deviceName ?? null,
          model: device.model ?? null,
          provider_request_id:
            preflight.headers.get('request-id') ||
            preflight.headers.get('client-request-id'),
          http_status: preflight.status,
          observed_at: observedAt,
        };
        const preflightSha = createHash('sha256')
          .update(JSON.stringify(providerPreflight))
          .digest('hex');
        const authorizationRequestId = randomUUID();
        const authorizationArgs = {
            p_action_id: action.action_id,
            p_lease_token: action.lease_token,
            p_worker_id: workerId,
            p_expected_row_version: action.row_version,
            p_authorization_request_id: authorizationRequestId,
            p_provider_preflight: providerPreflight,
            p_client_preflight_sha256: preflightSha,
          };
        let authorization: unknown = null;
        let authorizationError: { message: string } | null = null;
        for (let attempt = 0; attempt < 2 && !authorization; attempt += 1) {
          const response = await sb.rpc(
            'authorize_it_intune_dispatch_v4',
            authorizationArgs,
          );
          authorization = response.data;
          authorizationError = response.error;
          if (authorizationError && attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
        if (authorizationError || !authorization) {
          throw new Error(
            authorizationError?.message ||
              'Dispatch authorization returned no evidence',
          );
        }
        const authorized = authorization as {
          dispatch_attempt_id: string;
          authorization_token: string;
          row_version: number;
          canary_token?: string | null;
        };
        dispatchAuthorized = true;
        authorizedCount += 1;
        dispatchAttemptId = authorized.dispatch_attempt_id;
        authorizationToken = authorized.authorization_token;
        canaryToken = authorized.canary_token ?? null;
        finishRowVersion = authorized.row_version;
        providerPostStarted = true;
        activeRequestKind = 'dispatch_post';
        activeObservationKey = randomUUID();
        const res = await fetch(
          `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/${encodeURIComponent(action.managed_device_id)}/retire`,
          {
            method: 'POST',
            headers: {
              ...headers,
              'client-request-id': authorized.dispatch_attempt_id,
            },
            signal: AbortSignal.timeout(20_000),
          },
        );
        graphRequestId =
          res.headers.get('request-id') ||
          res.headers.get('client-request-id');
        await recordObservation({
          requestKind: 'dispatch_post',
          observationKey: activeObservationKey,
          httpStatus: res.status,
          observationErrorCode:
            res.status === 429
              ? 'provider_throttled_ambiguous'
              : res.status >= 500 || [408, 425].includes(res.status)
                ? 'provider_response_ambiguous'
                : [401, 403].includes(res.status)
                  ? 'permission_denied'
                  : null,
          requestId: graphRequestId,
          observationEvidence: { provider_post_started: true },
        });
        activeRequestKind = null;
        activeObservationKey = null;
        evidence = {
          http_status: res.status,
          graph_request_id: graphRequestId,
          submitted_at: new Date().toISOString(),
          provider_post_started: true,
        };
        if (res.ok) {
          nextStatus = 'submitted';
          detail = `Graph accepted retirement (${res.status})`;
        } else if (
          [408, 409, 425, 429].includes(res.status) ||
          res.status >= 500
        ) {
          nextStatus = 'verifying';
          errorMessage = `Ambiguous Graph HTTP ${res.status}; polling before retry`;
          errorCode =
            res.status === 429
              ? 'provider_throttled_ambiguous'
              : 'provider_response_ambiguous';
          errorClass = 'ambiguous';
          retryAfterSeconds =
            res.status === 429
              ? Number(res.headers.get('retry-after') ?? 300)
              : null;
          detail = errorMessage;
        } else {
          nextStatus = 'failed';
          errorMessage = `Graph rejected retirement (${res.status})`;
          verificationCode = 'provider_rejected';
          errorCode = 'provider_rejected';
          errorClass =
            res.status === 401 || res.status === 403 ? 'platform' : 'permanent';
          detail = errorMessage;
        }
        }
      } else {
        activeRequestKind = 'verification_read';
        activeObservationKey = randomUUID();
        const res = await fetch(
          `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/${encodeURIComponent(action.managed_device_id)}?$select=id,managementState,lastSyncDateTime`,
          { headers, signal: AbortSignal.timeout(20_000) },
        );
        const json = (await res.json().catch(() => ({}))) as {
          managementState?: string;
          lastSyncDateTime?: string;
        };
        const providerState = json.managementState?.toLowerCase() ?? null;
        await recordObservation({
          requestKind: 'verification_read',
          observationKey: activeObservationKey,
          httpStatus: res.status,
          observationErrorCode:
            res.status === 429
              ? 'provider_throttled'
              : res.status >= 500
                ? 'provider_5xx'
                : [401, 403].includes(res.status)
                  ? 'permission_denied'
                  : null,
          requestId:
            res.headers.get('request-id') ||
            res.headers.get('client-request-id'),
        });
        activeRequestKind = null;
        activeObservationKey = null;
        evidence = {
          http_status: res.status,
          provider_state: providerState,
          last_sync_at: json.lastSyncDateTime ?? null,
          checked_at: new Date().toISOString(),
        };
        if (providerState === 'retired') {
          nextStatus = 'verified';
          verificationCode = 'management_state_retired';
          detail = 'Provider reports managementState=retired';
        } else if (res.status === 404 && action.submitted_at) {
          nextStatus = 'manual_review';
          verificationCode = 'provider_absent_requires_bound_review';
          errorMessage =
            'Managed device is absent; Phase 38 requires bound audit evidence';
          detail = errorMessage;
        } else {
          const ageHours =
            (Date.now() - Date.parse(action.requested_at)) / 3_600_000;
          if (action.poll_count >= 32 || ageHours >= 24) {
            nextStatus = 'manual_review';
            verificationCode = 'manual_review_required';
            errorMessage = 'Retirement was not verified within policy';
            detail = errorMessage;
          } else if (res.status === 401 || res.status === 403) {
            nextStatus = 'verifying';
            errorCode = 'permission_denied';
            errorClass = 'platform';
            errorMessage = `Graph authorization failed (${res.status})`;
            detail = errorMessage;
          } else if (res.status === 429 || res.status >= 500) {
            nextStatus = 'verifying';
            errorCode =
              res.status === 429 ? 'provider_throttled' : 'provider_5xx';
            errorClass = res.status === 429 ? 'transient' : 'ambiguous';
            errorMessage = `Graph verification HTTP ${res.status}`;
            detail = errorMessage;
          } else {
            nextStatus = 'verifying';
            detail = `Provider state ${providerState ?? `HTTP ${res.status}`}; poll scheduled`;
          }
        }
      }
    } catch (caught) {
      const caughtMessage =
        caught instanceof Error ? caught.message : 'Graph transport failure';
      const circuitBlocked = caughtMessage.includes(
        'Intune provider circuit',
      );
      nextStatus = dispatchAuthorized || providerPostStarted
        ? 'verifying'
        : 'approved';
      errorMessage = caughtMessage;
      evidence = {
        provider_state: 'transport_ambiguous',
        checked_at: new Date().toISOString(),
        provider_post_started: providerPostStarted,
      };
      errorCode = providerPostStarted
        ? 'transport_ambiguous'
        : circuitBlocked
          ? 'provider_circuit_open'
          : activeRequestKind
            ? 'provider_transport'
            : 'preflight_transport';
      errorClass = providerPostStarted ? 'ambiguous' : 'transient';
      detail = dispatchAuthorized || providerPostStarted
        ? `${errorMessage}; polling before retry`
        : `${errorMessage}; dispatch was not attempted`;
      if (
        activeRequestKind &&
        activeObservationKey &&
        !errorMessage.startsWith('Provider outcome persistence failed')
      ) {
        try {
          await recordObservation({
            requestKind: activeRequestKind,
            observationKey: activeObservationKey,
            observationErrorCode:
              activeRequestKind === 'dispatch_post'
                ? 'transport_ambiguous'
                : 'provider_transport',
            observationEvidence: {
              provider_post_started: providerPostStarted,
              transport_failure: true,
            },
          });
        } catch {
          // The finish fence still records the action ambiguity. Never retry POST.
        }
      }
    }
    const { error: finishError } = await sb.rpc('finish_it_intune_action_v4', {
      p_action_id: action.action_id,
      p_lease_token: action.lease_token,
      p_worker_id: workerId,
      p_expected_row_version: finishRowVersion,
      p_status: nextStatus,
      p_evidence: evidence,
      p_error: errorMessage,
      p_verification_code: verificationCode,
      p_graph_request_id: graphRequestId,
      p_error_code: errorCode,
      p_error_class: errorClass,
      p_retry_after_seconds: retryAfterSeconds,
      p_dispatch_attempt_id: dispatchAttemptId,
      p_authorization_token: authorizationToken,
      p_canary_token: canaryToken,
    });
    if (nextStatus === 'verifying' && (dispatchAuthorized || providerPostStarted)) {
      ambiguousCount += 1;
    }
    processed.push({
      action_id: action.action_id,
      status: finishError ? 'lease_error' : nextStatus,
      detail: finishError?.message || detail,
    });
  }
  let workerRunFinishError: string | undefined;
  if (workerRun) {
    const failed = processed.filter((item) =>
      ['failed', 'lease_error'].includes(item.status),
    ).length;
    const { error: runFinishError } = await sb
      .from('os_it_intune_worker_runs')
      .update({
        status: failed > 0 ? 'partial' : 'completed',
        claimed: actions.length,
        succeeded: processed.length - failed,
        failed,
        lease_conflicts: processed.filter(
          (item) => item.status === 'lease_error',
        ).length,
        preflighted,
        authorized: authorizedCount,
        ambiguous: ambiguousCount,
        recovered: recoveredCount,
        completed_at: new Date().toISOString(),
      })
      .eq('worker_run_id', workerRun.worker_run_id);
    workerRunFinishError = runFinishError?.message;
  }
  return {
    ok:
      !workerRunFinishError &&
      processed.every(
        (item) => !['failed', 'lease_error'].includes(item.status),
      ),
    claimed: actions.length,
    processed,
    error: workerRunFinishError,
  };
}
