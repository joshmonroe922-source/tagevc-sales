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
};

export async function processIntuneActions(limit = 10): Promise<{
  ok: boolean;
  claimed: number;
  processed: Array<{ action_id: string; status: string; detail: string }>;
  error?: string;
}> {
  if (!graphConfigured()) {
    return {
      ok: false,
      claimed: 0,
      processed: [],
      error: 'MS_GRAPH_* is not configured',
    };
  }
  const token = await getMsGraphToken();
  if (!token.ok) {
    return { ok: false, claimed: 0, processed: [], error: token.detail };
  }
  const sb = await createPersistClient();
  const workerId = `intune-${randomUUID()}`;
  const { data, error } = await sb.rpc('claim_it_intune_actions', {
    p_worker_id: workerId,
    p_limit: Math.min(Math.max(limit, 1), 20),
    p_lease_seconds: 90,
  });
  if (error) {
    return { ok: false, claimed: 0, processed: [], error: error.message };
  }
  const actions = (data ?? []) as ClaimedAction[];
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
    try {
      if (action.status === 'dispatching') {
        const preflight = await fetch(
          `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/${encodeURIComponent(action.managed_device_id)}?$select=id,serialNumber,managementState,deviceName,model`,
          { headers },
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
          nextStatus = 'failed';
          verificationCode =
            preflight.status === 404
              ? 'provider_missing_before_dispatch'
              : 'asset_provider_mismatch';
          errorMessage =
            preflight.status === 404
              ? 'Managed device disappeared before dispatch'
              : 'Live provider identity no longer matches approved asset';
          evidence = {
            http_status: preflight.status,
            provider_state: device.managementState ?? null,
            failure_code: verificationCode,
            live_serial_suffix: liveSerial.slice(-4),
            approved_serial_suffix: approvedSerial.slice(-4),
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
        const res = await fetch(
          `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/${encodeURIComponent(action.managed_device_id)}/retire`,
          {
            method: 'POST',
            headers: {
              ...headers,
              'client-request-id': `${action.action_id}:${action.attempt_count + 1}`,
            },
          },
        );
        graphRequestId =
          res.headers.get('request-id') ||
          res.headers.get('client-request-id');
        evidence = {
          http_status: res.status,
          graph_request_id: graphRequestId,
          submitted_at: new Date().toISOString(),
        };
        if (res.ok) {
          nextStatus = 'submitted';
          detail = `Graph accepted retirement (${res.status})`;
        } else if (res.status === 429) {
          nextStatus = 'approved';
          errorMessage = 'Graph throttled retirement request';
          detail = errorMessage;
        } else if (res.status >= 500) {
          nextStatus = 'verifying';
          errorMessage = `Ambiguous Graph HTTP ${res.status}; polling before retry`;
          detail = errorMessage;
        } else {
          nextStatus = 'failed';
          errorMessage = `Graph rejected retirement (${res.status})`;
          verificationCode = 'provider_rejected';
          detail = errorMessage;
        }
        }
      } else {
        const res = await fetch(
          `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/${encodeURIComponent(action.managed_device_id)}?$select=id,managementState,lastSyncDateTime`,
          { headers },
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
      };
      detail = `${errorMessage}; polling before retry`;
    }
    const { error: finishError } = await sb.rpc('finish_it_intune_action', {
      p_action_id: action.action_id,
      p_lease_token: action.lease_token,
      p_status: nextStatus,
      p_evidence: evidence,
      p_error: errorMessage,
      p_verification_code: verificationCode,
      p_graph_request_id: graphRequestId,
    });
    processed.push({
      action_id: action.action_id,
      status: finishError ? 'lease_error' : nextStatus,
      detail: finishError?.message || detail,
    });
  }
  return {
    ok: processed.every(
      (item) => !['failed', 'lease_error'].includes(item.status),
    ),
    claimed: actions.length,
    processed,
  };
}
