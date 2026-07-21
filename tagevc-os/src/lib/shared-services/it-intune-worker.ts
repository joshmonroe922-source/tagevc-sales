import { randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  getMsGraphToken,
  graphConfigured,
} from '@/lib/shared-services/it-mdm';

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
};

export async function processIntuneActions(): Promise<{
  ok: boolean;
  claimed: number;
  processed: Array<{ action_id: string; status: string; detail: string }>;
  error?: string;
}> {
  const sb = await createPersistClient();
  const workerId = `intune-${randomUUID()}`;
  const { error: expiryError } = await sb.rpc(
    'expire_it_intune_actions_v2',
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
  const { data, error } = await sb.rpc('claim_it_intune_action_v2', {
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
  const headers = {
    Authorization: `Bearer ${token.token}`,
    'Content-Type': 'application/json',
  };
  for (const action of actions) {
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
    try {
      if (action.status === 'dispatching') {
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
        providerPostStarted = true;
        const res = await fetch(
          `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/${encodeURIComponent(action.managed_device_id)}/retire`,
          {
            method: 'POST',
            headers: {
              ...headers,
              'client-request-id': `${action.action_id}:${action.attempt_count + 1}`,
            },
            signal: AbortSignal.timeout(20_000),
          },
        );
        graphRequestId =
          res.headers.get('request-id') ||
          res.headers.get('client-request-id');
        evidence = {
          http_status: res.status,
          graph_request_id: graphRequestId,
          submitted_at: new Date().toISOString(),
          provider_post_started: true,
        };
        if (res.ok) {
          nextStatus = 'submitted';
          detail = `Graph accepted retirement (${res.status})`;
        } else if (res.status === 429) {
          nextStatus = 'approved';
          errorMessage = 'Graph throttled retirement request';
          errorCode = 'provider_throttled';
          errorClass = 'transient';
          retryAfterSeconds = Number(res.headers.get('retry-after') ?? 300);
          detail = errorMessage;
        } else if (res.status >= 500) {
          nextStatus = 'verifying';
          errorMessage = `Ambiguous Graph HTTP ${res.status}; polling before retry`;
          errorCode = 'provider_5xx_ambiguous';
          errorClass = 'ambiguous';
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
        const res = await fetch(
          `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/${encodeURIComponent(action.managed_device_id)}?$select=id,managementState,lastSyncDateTime`,
          { headers, signal: AbortSignal.timeout(20_000) },
        );
        const json = (await res.json().catch(() => ({}))) as {
          managementState?: string;
          lastSyncDateTime?: string;
        };
        const providerState = json.managementState?.toLowerCase() ?? null;
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
        } else if (
          res.status === 404 &&
          action.submitted_at
        ) {
          nextStatus = 'verified';
          verificationCode = 'resource_absent_after_accepted_submission';
          detail = 'Managed device absent after retirement dispatch';
        } else {
          const ageHours =
            (Date.now() - Date.parse(action.requested_at)) / 3_600_000;
          if (action.poll_count >= 32 || ageHours >= 24) {
            nextStatus = 'failed';
            verificationCode = 'poll_timeout';
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
      nextStatus = 'verifying';
      errorMessage =
        caught instanceof Error ? caught.message : 'Graph transport failure';
      evidence = {
        provider_state: 'transport_ambiguous',
        checked_at: new Date().toISOString(),
        provider_post_started: providerPostStarted,
      };
      errorCode = providerPostStarted
        ? 'transport_ambiguous'
        : 'preflight_transport';
      errorClass = providerPostStarted ? 'ambiguous' : 'transient';
      nextStatus = providerPostStarted ? 'verifying' : 'approved';
      detail = providerPostStarted
        ? `${errorMessage}; polling before retry`
        : `${errorMessage}; dispatch was not attempted`;
    }
    const { error: finishError } = await sb.rpc('finish_it_intune_action_v2', {
      p_action_id: action.action_id,
      p_lease_token: action.lease_token,
      p_worker_id: workerId,
      p_expected_row_version: action.row_version,
      p_status: nextStatus,
      p_evidence: evidence,
      p_error: errorMessage,
      p_verification_code: verificationCode,
      p_graph_request_id: graphRequestId,
      p_error_code: errorCode,
      p_error_class: errorClass,
      p_retry_after_seconds: retryAfterSeconds,
    });
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
