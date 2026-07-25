/**
 * MDM / Intune lifecycle hooks (Phases 25–27).
 * Prefer Microsoft Graph Intune when MS_GRAPH_* is set; also posts MDM_WEBHOOK_URL.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { randomUUID } from 'crypto';

type MdmResult = {
  ok: boolean;
  skipped?: boolean;
  pending?: boolean;
  detail: string;
};

export function graphConfigured(): boolean {
  return Boolean(
    process.env.MS_GRAPH_TENANT_ID?.trim() &&
      process.env.MS_GRAPH_CLIENT_ID?.trim() &&
      process.env.MS_GRAPH_CLIENT_SECRET?.trim(),
  );
}

export async function getMsGraphToken(): Promise<
  { ok: true; token: string } | { ok: false; detail: string }
> {
  const tenant = process.env.MS_GRAPH_TENANT_ID!.trim();
  const clientId = process.env.MS_GRAPH_CLIENT_ID!.trim();
  const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET!.trim();
  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });
    const res = await fetch(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        detail: `Graph token HTTP ${res.status}: ${text.slice(0, 120)}`,
      };
    }
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) {
      return { ok: false, detail: 'Graph token response missing access_token' };
    }
    return { ok: true, token: json.access_token };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : 'Graph token failed',
    };
  }
}

export type IntuneAmbiguityEvidence = {
  evidence_version: 'phase38-v1';
  managed_device_id: string;
  observed_at: string;
  http_status: number;
  graph_request_id: string;
  provider_request_id: string | null;
  audit_http_status: number;
  audit_graph_request_id: string;
  audit_provider_request_id: string | null;
  outcome: 'present' | 'not_found' | 'error';
  provider_body: {
    id: string | null;
    deviceName: string | null;
    serialNumber: string | null;
    managementState: string | null;
    lastSyncDateTime: string | null;
  } | null;
  retirement_audit: {
    id: string;
    display_name: string;
    activity_datetime: string;
    activity_result: string;
    resource_id: string;
  } | null;
};

export type IntuneAuditEventInput = {
  id?: string;
  displayName?: string;
  activityDateTime?: string;
  activityResult?: string;
  resources?: Array<{ resourceId?: string }>;
};

export function selectBoundRetirementAudit(
  events: IntuneAuditEventInput[],
  managedDeviceId: string,
): IntuneAmbiguityEvidence['retirement_audit'] {
  for (const event of events.slice(0, 100)) {
    const resource = event.resources?.find(
      (candidate) => candidate.resourceId === managedDeviceId,
    );
    if (
      resource?.resourceId &&
      event.id &&
      event.displayName &&
      event.activityDateTime &&
      event.activityResult &&
      /retire/i.test(event.displayName) &&
      /^success$/i.test(event.activityResult)
    ) {
      return {
        id: event.id,
        display_name: event.displayName,
        activity_datetime: event.activityDateTime,
        activity_result: event.activityResult,
        resource_id: resource.resourceId,
      };
    }
  }
  return null;
}

/**
 * Collect one independent, read-only observation for two-actor ambiguity review.
 * A 404 is recorded as not_found and is never translated to retired.
 */
export async function getIntuneAmbiguityEvidence(
  managedDeviceId: string,
): Promise<IntuneAmbiguityEvidence> {
  if (!graphConfigured()) {
    throw new Error('MS_GRAPH_* is required for Intune ambiguity review');
  }
  const token = await getMsGraphToken();
  if (!token.ok) throw new Error(token.detail);
  const clientRequestId = randomUUID();
  const auditClientRequestId = randomUUID();
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/${encodeURIComponent(
      managedDeviceId,
    )}?$select=id,deviceName,serialNumber,managementState,lastSyncDateTime`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token.token}`,
        'client-request-id': clientRequestId,
        'return-client-request-id': 'true',
      },
      cache: 'no-store',
    },
  );
  let providerBody: IntuneAmbiguityEvidence['provider_body'] = null;
  if (response.ok) {
    const body = (await response.json()) as Record<string, unknown>;
    providerBody = {
      id: typeof body.id === 'string' ? body.id : null,
      deviceName: typeof body.deviceName === 'string' ? body.deviceName : null,
      serialNumber:
        typeof body.serialNumber === 'string' ? body.serialNumber : null,
      managementState:
        typeof body.managementState === 'string' ? body.managementState : null,
      lastSyncDateTime:
        typeof body.lastSyncDateTime === 'string' ? body.lastSyncDateTime : null,
    };
  } else {
    await response.text().catch(() => '');
  }
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const auditResponse = await fetch(
    `https://graph.microsoft.com/v1.0/deviceManagement/auditEvents?${new URLSearchParams(
      {
        $filter: `activityDateTime ge ${since}`,
        $orderby: 'activityDateTime desc',
        $top: '100',
        $select:
          'id,displayName,activityDateTime,activityResult,resources',
      },
    ).toString()}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token.token}`,
        'client-request-id': auditClientRequestId,
        'return-client-request-id': 'true',
      },
      cache: 'no-store',
    },
  );
  let retirementAudit: IntuneAmbiguityEvidence['retirement_audit'] = null;
  if (auditResponse.ok) {
    const auditBody = (await auditResponse.json()) as {
      value?: IntuneAuditEventInput[];
    };
    retirementAudit = selectBoundRetirementAudit(
      auditBody.value ?? [],
      managedDeviceId,
    );
  } else {
    await auditResponse.text().catch(() => '');
  }
  return {
    evidence_version: 'phase38-v1',
    managed_device_id: managedDeviceId,
    observed_at: new Date().toISOString(),
    http_status: response.status,
    graph_request_id: clientRequestId,
    provider_request_id:
      response.headers.get('request-id') ??
      response.headers.get('x-ms-request-id'),
    audit_http_status: auditResponse.status,
    audit_graph_request_id: auditClientRequestId,
    audit_provider_request_id:
      auditResponse.headers.get('request-id') ??
      auditResponse.headers.get('x-ms-request-id'),
    outcome: response.ok
      ? 'present'
      : response.status === 404
        ? 'not_found'
        : 'error',
    provider_body: providerBody,
    retirement_audit: retirementAudit,
  };
}

async function resolveGraphUserId(
  token: string,
  input: { user_id: string; email?: string | null },
): Promise<string | null> {
  const headers = { Authorization: `Bearer ${token}` };
  // Prefer UPN/email lookup — Entra object id rarely matches OS profile UUID.
  if (input.email?.trim()) {
    const esc = input.email.trim().replace(/'/g, "''");
    const filter = encodeURIComponent(
      `mail eq '${esc}' or userPrincipalName eq '${esc}'`,
    );
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users?$filter=${filter}&$select=id&$top=1`,
      { headers },
    );
    if (res.ok) {
      const json = (await res.json()) as { value?: Array<{ id?: string }> };
      const id = json.value?.[0]?.id;
      if (id) return id;
    }
  }
  const byId = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(input.user_id)}?$select=id`,
    { headers },
  );
  if (byId.ok) {
    const json = (await byId.json()) as { id?: string };
    return json.id ?? null;
  }
  return null;
}

async function invokeGraphIntuneLifecycle(input: {
  action: 'offboard' | 'onboard';
  user_id: string;
  run_id: string;
  entity_id?: string | null;
  email?: string | null;
}): Promise<MdmResult> {
  if (!graphConfigured()) {
    return {
      ok: false,
      skipped: true,
      detail: 'MS_GRAPH_* not set — skip Intune Graph',
    };
  }
  const tok = await getMsGraphToken();
  if (!tok.ok) return { ok: false, detail: tok.detail };

  try {
    const graphUserId = await resolveGraphUserId(tok.token, input);
    if (!graphUserId) {
      return {
        ok: false,
        detail: `Graph user not found for ${input.email || input.user_id}`,
      };
    }

    const headers = {
      Authorization: `Bearer ${tok.token}`,
      'Content-Type': 'application/json',
    };
    type GraphDevice = {
      id?: string;
      deviceName?: string;
      operatingSystem?: string;
      managementState?: string;
      serialNumber?: string;
      manufacturer?: string;
      model?: string;
      complianceState?: string;
      managedDeviceOwnerType?: string;
      isEncrypted?: boolean;
      lastSyncDateTime?: string;
    };
    const devices: GraphDevice[] = [];
    let nextUrl: string | null =
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(graphUserId)}/managedDevices?` +
      '$select=id,deviceName,operatingSystem,managementState,serialNumber,manufacturer,model,complianceState,managedDeviceOwnerType,isEncrypted,lastSyncDateTime';
    let pages = 0;
    while (nextUrl && pages < 5) {
      const devicesRes = await fetch(nextUrl, { headers });
      if (!devicesRes.ok) {
        const text = await devicesRes.text().catch(() => '');
        return {
          ok: false,
          detail: `Intune devices HTTP ${devicesRes.status}: ${text.slice(0, 120)}`,
        };
      }
      const devicesJson = (await devicesRes.json()) as {
      value?: Array<{
        id?: string;
      }>;
        '@odata.nextLink'?: string;
      };
      devices.push(...((devicesJson.value ?? []) as GraphDevice[]));
      const candidate = devicesJson['@odata.nextLink'] ?? null;
      nextUrl =
        candidate?.startsWith('https://graph.microsoft.com/') ? candidate : null;
      pages += 1;
    }
    const truncated = Boolean(nextUrl);
    const summary =
      devices.length === 0
        ? '0 managed devices'
        : devices
            .slice(0, 5)
            .map(
              (d) =>
                `${d.deviceName || d.id}${
                  d.operatingSystem ? ` (${d.operatingSystem})` : ''
                }${d.complianceState ? ` · ${d.complianceState}` : ''}${
                  d.isEncrypted === false ? ' · NOT ENCRYPTED' : ''
                }${d.lastSyncDateTime ? ` · sync ${d.lastSyncDateTime.slice(0, 10)}` : ''}`,
            )
            .join(', ');

    if (input.action === 'offboard' && devices.length > 0) {
      const audit = await createPersistClient();
      for (const d of devices.slice(0, 10)) {
        if (!d.id) continue;
        const idempotencyKey = `${input.run_id}:${d.id}:retire`;
        const { data: action, error: intentError } = await audit
          .from('os_it_intune_actions')
          .insert({
            idempotency_key: idempotencyKey,
            run_id: input.run_id,
            item_id: 'mdm',
            managed_device_id: d.id,
            user_id: input.user_id,
            entity_id: input.entity_id ?? null,
            action_type: 'retire',
            status: 'requested',
            request_metadata: {
              device_name: d.deviceName ?? null,
              serial_number: d.serialNumber ?? null,
              model: d.model ?? null,
              compliance_state: d.complianceState ?? null,
              encrypted: d.isEncrypted ?? null,
              operating_system: d.operatingSystem ?? null,
              last_sync_at: d.lastSyncDateTime ?? null,
              requested_by: 'offboarding_inventory',
            },
          })
          .select('action_id')
          .maybeSingle();
        if (action) {
          await audit.from('os_it_intune_action_events').insert({
            action_id: action.action_id,
            from_status: null,
            to_status: 'requested',
            source: 'offboarding',
            evidence: { idempotency_key: idempotencyKey },
            transition_key: `${action.action_id}:requested:0`,
            row_version: 0,
          });
        } else if (intentError?.code !== '23505') {
          return {
            ok: false,
            detail: `Intune intent persistence failed for ${d.id}: ${intentError?.message ?? 'unknown'}`,
          };
        }
      }
      const { data: actions } = await audit
        .from('os_it_intune_actions')
        .select('managed_device_id, status')
        .eq('run_id', input.run_id)
        .eq('action_type', 'retire');
      const states = (actions ?? []).map((action) => String(action.status));
      const allVerified =
        states.length > 0 && states.every((status) => status === 'verified');
      const hasFailure = states.some((status) => status === 'failed');
      return {
        ok: allVerified,
        pending: !allVerified && !hasFailure,
        skipped: !allVerified && !hasFailure,
        detail: `Intune offboard · ${devices.length} inventoried across ${pages} page(s)${
          truncated ? ' (truncated)' : ''
        } · actions ${states.join(', ') || 'requested'}${
          allVerified
            ? ' · all verified'
            : ' · explicit approval and worker verification required'
        }`,
      };
    }

    return {
      ok: true,
      detail: `Intune ${input.action} · ${devices.length} device(s), ${pages} page(s)${
        truncated ? ' (truncated)' : ''
      } · ${summary}`,
    };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : 'Graph Intune failed',
    };
  }
}

async function invokeMdmWebhook(input: {
  action: 'offboard' | 'onboard';
  user_id: string;
  run_id: string;
  entity_id?: string | null;
  email?: string | null;
}): Promise<MdmResult> {
  const url = process.env.MDM_WEBHOOK_URL?.trim();
  if (!url) {
    return {
      ok: false,
      skipped: true,
      detail: 'MDM_WEBHOOK_URL not set',
    };
  }
  try {
    const secret = process.env.MDM_WEBHOOK_SECRET?.trim();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({
        action: input.action,
        user_id: input.user_id,
        run_id: input.run_id,
        entity_id: input.entity_id ?? null,
        email: input.email ?? null,
        source: 'tagevc-os',
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        detail: `MDM webhook HTTP ${res.status}: ${text.slice(0, 120)}`,
      };
    }
    return { ok: true, detail: `MDM ${input.action} webhook accepted` };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : 'MDM webhook failed',
    };
  }
}

export async function invokeMdmLifecycleHook(input: {
  action: 'offboard' | 'onboard';
  user_id: string;
  run_id: string;
  entity_id?: string | null;
  email?: string | null;
}): Promise<MdmResult> {
  const graph = await invokeGraphIntuneLifecycle(input);
  const webhook = await invokeMdmWebhook(input);

  if (graph.pending) {
    return {
      ok: false,
      skipped: true,
      pending: true,
      detail: [graph.detail, webhook.skipped ? null : webhook.detail]
        .filter(Boolean)
        .join(' · '),
    };
  }

  if (graph.skipped && webhook.skipped) {
    return {
      ok: false,
      skipped: true,
      detail:
        'No MDM configured — set MS_GRAPH_* and/or MDM_WEBHOOK_URL; complete manually',
    };
  }

  const parts = [graph, webhook]
    .filter((r) => !r.skipped)
    .map((r) => r.detail);
  const configuredResults = [graph, webhook].filter((r) => !r.skipped);
  return {
    ok:
      configuredResults.length > 0 &&
      configuredResults.every((result) => result.ok),
    detail: parts.join(' · ') || 'MDM no-op',
  };
}

/** @deprecated Prefer invokeMdmLifecycleHook({ action: 'offboard', … }) */
export async function invokeMdmOffboardHook(input: {
  user_id: string;
  run_id: string;
  entity_id?: string | null;
  email?: string | null;
}) {
  return invokeMdmLifecycleHook({ ...input, action: 'offboard' });
}

/**
 * Add user to Entra groups listed in MS_GRAPH_ONBOARD_GROUP_IDS (comma-separated).
 * Opt-in: MS_GRAPH_ASSIGN_GROUPS=1
 */
export async function assignGraphGroupMembership(input: {
  user_id: string;
  email?: string | null;
}): Promise<MdmResult> {
  const enabled =
    process.env.MS_GRAPH_ASSIGN_GROUPS === '1' ||
    process.env.MS_GRAPH_ASSIGN_GROUPS === 'true';
  if (!enabled) {
    return {
      ok: false,
      skipped: true,
      detail: 'MS_GRAPH_ASSIGN_GROUPS not enabled',
    };
  }
  if (!graphConfigured()) {
    return { ok: false, skipped: true, detail: 'MS_GRAPH_* not set' };
  }
  const groupIds = (process.env.MS_GRAPH_ONBOARD_GROUP_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (groupIds.length === 0) {
    return {
      ok: false,
      skipped: true,
      detail: 'MS_GRAPH_ONBOARD_GROUP_IDS empty',
    };
  }

  const tok = await getMsGraphToken();
  if (!tok.ok) return { ok: false, detail: tok.detail };
  const graphUserId = await resolveGraphUserId(tok.token, input);
  if (!graphUserId) {
    return {
      ok: false,
      detail: `Graph user not found for ${input.email || input.user_id}`,
    };
  }

  const headers = {
    Authorization: `Bearer ${tok.token}`,
    'Content-Type': 'application/json',
  };
  const results: string[] = [];
  for (const gid of groupIds.slice(0, 10)) {
    const existing = await fetch(
      `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(gid)}/members/${encodeURIComponent(graphUserId)}/$ref`,
      { headers },
    );
    if (existing.ok) {
      results.push(`exists ${gid.slice(0, 8)}…`);
      continue;
    }
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(gid)}/members/$ref`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${graphUserId}`,
        }),
      },
    );
    if (res.ok) {
      results.push(`added ${gid.slice(0, 8)}…`);
    } else {
      const text = await res.text().catch(() => '');
      results.push(`fail ${gid.slice(0, 8)}…:${res.status} ${text.slice(0, 40)}`);
    }
  }
  const ok = results.every((r) => r.startsWith('added') || r.startsWith('exists'));
  return { ok, detail: `Graph groups · ${results.join('; ')}` };
}

/**
 * Assign Microsoft 365 license SKUs listed in MS_GRAPH_ONBOARD_SKU_IDS.
 * Opt-in: MS_GRAPH_ASSIGN_SKUS=1
 */
export async function assignGraphLicenseSku(input: {
  user_id: string;
  email?: string | null;
}): Promise<MdmResult> {
  const enabled =
    process.env.MS_GRAPH_ASSIGN_SKUS === '1' ||
    process.env.MS_GRAPH_ASSIGN_SKUS === 'true';
  if (!enabled) {
    return {
      ok: false,
      skipped: true,
      detail: 'MS_GRAPH_ASSIGN_SKUS not enabled',
    };
  }
  if (!graphConfigured()) {
    return { ok: false, skipped: true, detail: 'MS_GRAPH_* not set' };
  }
  const skuIds = (process.env.MS_GRAPH_ONBOARD_SKU_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (skuIds.length === 0) {
    return {
      ok: false,
      skipped: true,
      detail: 'MS_GRAPH_ONBOARD_SKU_IDS empty',
    };
  }

  const tok = await getMsGraphToken();
  if (!tok.ok) return { ok: false, detail: tok.detail };
  const graphUserId = await resolveGraphUserId(tok.token, input);
  if (!graphUserId) {
    return {
      ok: false,
      detail: `Graph user not found for ${input.email || input.user_id}`,
    };
  }

  const headers = {
    Authorization: `Bearer ${tok.token}`,
    'Content-Type': 'application/json',
  };
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(graphUserId)}/assignLicense`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        addLicenses: skuIds.map((skuId) => ({
          skuId,
          disabledPlans: [],
        })),
        removeLicenses: [],
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      ok: false,
      detail: `Graph SKU HTTP ${res.status}: ${text.slice(0, 120)}`,
    };
  }
  return {
    ok: true,
    detail: `Graph SKUs assigned (${skuIds.length})`,
  };
}

/**
 * Remove user from Entra groups (Phase 29 offboard).
 * Opt-in: MS_GRAPH_REMOVE_GROUPS=1 — uses MS_GRAPH_OFFBOARD_GROUP_IDS or ONBOARD list.
 */
export async function removeGraphGroupMembership(input: {
  user_id: string;
  email?: string | null;
}): Promise<MdmResult> {
  const enabled =
    process.env.MS_GRAPH_REMOVE_GROUPS === '1' ||
    process.env.MS_GRAPH_REMOVE_GROUPS === 'true';
  if (!enabled) {
    return {
      ok: false,
      skipped: true,
      detail: 'MS_GRAPH_REMOVE_GROUPS not enabled',
    };
  }
  if (!graphConfigured()) {
    return { ok: false, skipped: true, detail: 'MS_GRAPH_* not set' };
  }
  const groupIds = (
    process.env.MS_GRAPH_OFFBOARD_GROUP_IDS ||
    process.env.MS_GRAPH_ONBOARD_GROUP_IDS ||
    ''
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (groupIds.length === 0) {
    return {
      ok: false,
      skipped: true,
      detail: 'No group IDs for offboard remove',
    };
  }

  const tok = await getMsGraphToken();
  if (!tok.ok) return { ok: false, detail: tok.detail };
  const graphUserId = await resolveGraphUserId(tok.token, input);
  if (!graphUserId) {
    return {
      ok: false,
      detail: `Graph user not found for ${input.email || input.user_id}`,
    };
  }

  const headers = { Authorization: `Bearer ${tok.token}` };
  const results: string[] = [];
  for (const gid of groupIds.slice(0, 10)) {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(gid)}/members/${encodeURIComponent(graphUserId)}/$ref`,
      { method: 'DELETE', headers },
    );
    if (res.ok || res.status === 204 || res.status === 404) {
      results.push(
        res.status === 404
          ? `absent ${gid.slice(0, 8)}…`
          : `removed ${gid.slice(0, 8)}…`,
      );
    } else {
      const text = await res.text().catch(() => '');
      results.push(`fail ${gid.slice(0, 8)}…:${res.status} ${text.slice(0, 40)}`);
    }
  }
  const ok = results.every(
    (r) => r.startsWith('removed') || r.startsWith('absent'),
  );
  return { ok, detail: `Graph groups remove · ${results.join('; ')}` };
}

/**
 * Remove M365 license SKUs on offboard (Phase 29).
 * Opt-in: MS_GRAPH_REMOVE_SKUS=1
 */
export async function removeGraphLicenseSku(input: {
  user_id: string;
  email?: string | null;
}): Promise<MdmResult> {
  const enabled =
    process.env.MS_GRAPH_REMOVE_SKUS === '1' ||
    process.env.MS_GRAPH_REMOVE_SKUS === 'true';
  if (!enabled) {
    return {
      ok: false,
      skipped: true,
      detail: 'MS_GRAPH_REMOVE_SKUS not enabled',
    };
  }
  if (!graphConfigured()) {
    return { ok: false, skipped: true, detail: 'MS_GRAPH_* not set' };
  }
  const skuIds = (
    process.env.MS_GRAPH_OFFBOARD_SKU_IDS ||
    process.env.MS_GRAPH_ONBOARD_SKU_IDS ||
    ''
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (skuIds.length === 0) {
    return {
      ok: false,
      skipped: true,
      detail: 'No SKU IDs for offboard remove',
    };
  }

  const tok = await getMsGraphToken();
  if (!tok.ok) return { ok: false, detail: tok.detail };
  const graphUserId = await resolveGraphUserId(tok.token, input);
  if (!graphUserId) {
    return {
      ok: false,
      detail: `Graph user not found for ${input.email || input.user_id}`,
    };
  }

  const headers = {
    Authorization: `Bearer ${tok.token}`,
    'Content-Type': 'application/json',
  };
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(graphUserId)}/assignLicense`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        addLicenses: [],
        removeLicenses: skuIds,
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      ok: false,
      detail: `Graph SKU remove HTTP ${res.status}: ${text.slice(0, 120)}`,
    };
  }
  return {
    ok: true,
    detail: `Graph SKUs removed (${skuIds.length})`,
  };
}

/**
 * Disable sign-in / mailbox access for a user (Phase 30).
 * PATCH accountEnabled=false when MS_GRAPH_DISABLE_ACCOUNT=1.
 */
export async function disableGraphMailbox(input: {
  user_id: string;
  email?: string | null;
}): Promise<MdmResult> {
  const enabled =
    process.env.MS_GRAPH_DISABLE_ACCOUNT === '1' ||
    process.env.MS_GRAPH_DISABLE_ACCOUNT === 'true';
  if (!enabled) {
    return {
      ok: false,
      skipped: true,
      detail: 'MS_GRAPH_DISABLE_ACCOUNT not enabled',
    };
  }
  if (!graphConfigured()) {
    return { ok: false, skipped: true, detail: 'MS_GRAPH_* not set' };
  }

  const tok = await getMsGraphToken();
  if (!tok.ok) return { ok: false, detail: tok.detail };
  const graphUserId = await resolveGraphUserId(tok.token, input);
  if (!graphUserId) {
    return {
      ok: false,
      detail: `Graph user not found for ${input.email || input.user_id}`,
    };
  }

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(graphUserId)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${tok.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ accountEnabled: false }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      ok: false,
      detail: `Graph disable account HTTP ${res.status}: ${text.slice(0, 120)}`,
    };
  }
  return {
    ok: true,
    detail: `Graph sign-in disabled for ${input.email || input.user_id}`,
  };
}

/** Litigation hold requires Exchange Online; invoke a controlled automation endpoint. */
export async function applyExchangeMailboxRetention(input: {
  user_id: string;
  email?: string | null;
  run_id: string;
  entity_id?: string | null;
}): Promise<MdmResult> {
  const enabled =
    process.env.IT_OFFBOARD_LITIGATION_HOLD === '1' ||
    process.env.IT_OFFBOARD_LITIGATION_HOLD === 'true';
  if (!enabled) {
    return {
      ok: false,
      skipped: true,
      detail: 'IT_OFFBOARD_LITIGATION_HOLD not enabled',
    };
  }
  const url = process.env.EXCHANGE_AUTOMATION_URL?.trim();
  if (!url) {
    return {
      ok: false,
      detail:
        'EXCHANGE_AUTOMATION_URL required; Microsoft Graph cannot enable litigation hold',
    };
  }
  try {
    const secret = process.env.EXCHANGE_AUTOMATION_SECRET?.trim();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({
        action: 'enable_litigation_hold',
        user_id: input.user_id,
        email: input.email ?? null,
        run_id: input.run_id,
        entity_id: input.entity_id ?? null,
        source: 'tagevc-os',
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        detail: `Exchange hold HTTP ${res.status}: ${text.slice(0, 160)}`,
      };
    }
    const json = (await res.json().catch(() => ({}))) as {
      verified?: boolean;
      job_id?: string;
      detail?: string;
      hold_enabled_at?: string;
    };
    if (json.verified !== true) {
      return {
        ok: false,
        skipped: true,
        detail: `Exchange hold submitted${
          json.job_id ? ` · job ${json.job_id}` : ''
        } · awaiting provider verification${
          json.detail ? ` · ${json.detail}` : ''
        }`,
      };
    }
    return {
      ok: true,
      detail: `Exchange litigation hold verified for ${
        input.email || input.user_id
      }${json.hold_enabled_at ? ` · enabled ${json.hold_enabled_at}` : ''}${
        json.job_id ? ` · job ${json.job_id}` : ''
      }`,
    };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : 'Exchange hold failed',
    };
  }
}

/** Apply the configured post-retention mailbox/user mode. */
export async function applyGraphMailboxOffboarding(input: {
  user_id: string;
  email?: string | null;
}): Promise<MdmResult> {
  const mode = (
    process.env.IT_OFFBOARD_MAILBOX_MODE || 'disable_only'
  ).trim().toLowerCase();
  if (mode !== 'soft_delete_user') {
    const disabled = await disableGraphMailbox(input);
    return {
      ...disabled,
      detail: `${disabled.detail} · mode=${mode}`,
    };
  }
  const enabled =
    process.env.MS_GRAPH_SOFT_DELETE_USER === '1' ||
    process.env.MS_GRAPH_SOFT_DELETE_USER === 'true';
  if (!enabled) {
    return {
      ok: false,
      skipped: true,
      detail:
        'soft_delete_user selected but MS_GRAPH_SOFT_DELETE_USER not enabled',
    };
  }
  if (!graphConfigured()) {
    return { ok: false, skipped: true, detail: 'MS_GRAPH_* not set' };
  }
  const tok = await getMsGraphToken();
  if (!tok.ok) return { ok: false, detail: tok.detail };
  const graphUserId = await resolveGraphUserId(tok.token, input);
  if (!graphUserId) {
    return {
      ok: false,
      detail: `Graph user not found for ${input.email || input.user_id}`,
    };
  }
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(graphUserId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tok.token}` },
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      ok: false,
      detail: `Graph soft-delete user HTTP ${res.status}: ${text.slice(0, 120)}`,
    };
  }
  return {
    ok: true,
    detail: `Entra user soft-deleted for ${input.email || input.user_id} · restorable within tenant retention window`,
  };
}

/**
 * Grant Visionary "Read and manage" (FullAccess) on a user mailbox so Outlook
 * "Open another mailbox" works. Fail-soft when Graph is not configured.
 *
 * Required Entra app permissions (admin consent):
 * - Exchange.ManageAsApp (application) + Exchange Online role assignment, OR
 * - MailboxSettings.ReadWrite is NOT sufficient for FullAccess
 * Env:
 * - MS_GRAPH_* (tenant/client/secret)
 * - MS_GRAPH_VISIONARY_MAILBOX_UPN (default joshmonroe@tagevc.com)
 * - MS_GRAPH_GRANT_VISIONARY_MAILBOX=1 to enable live attempts
 *
 * See docs/MS_GRAPH_VISIONARY_MAILBOX.md
 */
export async function grantVisionaryMailboxFullAccess(input: {
  user_id?: string;
  email?: string | null;
}): Promise<MdmResult> {
  const enabled =
    process.env.MS_GRAPH_GRANT_VISIONARY_MAILBOX === '1' ||
    process.env.MS_GRAPH_GRANT_VISIONARY_MAILBOX === 'true';
  const visionaryUpn =
    process.env.MS_GRAPH_VISIONARY_MAILBOX_UPN?.trim() ||
    'joshmonroe@tagevc.com';

  if (!enabled) {
    return {
      ok: false,
      skipped: true,
      pending: true,
      detail:
        'Checklist step visible. Set MS_GRAPH_GRANT_VISIONARY_MAILBOX=1 and Graph Exchange.ManageAsApp to auto-grant FullAccess.',
    };
  }
  if (!graphConfigured()) {
    return {
      ok: false,
      skipped: true,
      pending: true,
      detail: 'MS_GRAPH_* not set — keep checklist step open for IT',
    };
  }

  const tok = await getMsGraphToken();
  if (!tok.ok) return { ok: false, detail: tok.detail };

  const targetId = await resolveGraphUserId(tok.token, {
    user_id: input.user_id || input.email || '',
    email: input.email,
  });
  if (!targetId) {
    return {
      ok: false,
      pending: true,
      detail: `Graph user not found for ${input.email || input.user_id}`,
    };
  }

  // Graph beta mailbox permission grant (FullAccess ≈ Read and manage)
  const res = await fetch(
    `https://graph.microsoft.com/beta/users/${encodeURIComponent(targetId)}/mailboxPermissions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tok.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        emailAddress: { address: visionaryUpn },
        accessRights: ['fullAccess'],
        isInherited: false,
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      ok: false,
      pending: true,
      detail: `Graph mailbox FullAccess HTTP ${res.status}: ${text.slice(0, 180)}. Confirm Exchange.ManageAsApp + admin consent.`,
    };
  }

  return {
    ok: true,
    detail: `Granted FullAccess (Read and manage) on mailbox to ${visionaryUpn}`,
  };
}

export type GraphJoinerResult = MdmResult & {
  graph_user_id?: string;
  created?: boolean;
  updated?: boolean;
};

/**
 * Create or update an Entra/Microsoft user for HRIS joiner provision.
 * Opt-in: MS_GRAPH_CREATE_USERS=1
 * Requires User.ReadWrite.All (application) + admin consent.
 */
export async function createOrUpdateGraphUserJoiner(input: {
  display_name: string;
  work_email: string;
  job_title?: string | null;
  department?: string | null;
  entity_id?: string | null;
  mail_nickname?: string | null;
}): Promise<GraphJoinerResult> {
  const enabled =
    process.env.MS_GRAPH_CREATE_USERS === '1' ||
    process.env.MS_GRAPH_CREATE_USERS === 'true';
  if (!enabled) {
    return {
      ok: false,
      skipped: true,
      pending: true,
      detail:
        'MS_GRAPH_CREATE_USERS not enabled — keep bs.ms_email open for IT. Needs User.ReadWrite.All admin consent.',
    };
  }
  if (!graphConfigured()) {
    return {
      ok: false,
      skipped: true,
      pending: true,
      detail: 'MS_GRAPH_* not set — Graph joiner unavailable',
    };
  }

  const email = input.work_email.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return { ok: false, detail: 'Valid work_email required for Graph joiner' };
  }

  const tok = await getMsGraphToken();
  if (!tok.ok) return { ok: false, detail: tok.detail };

  const existingId = await resolveGraphUserId(tok.token, {
    user_id: email,
    email,
  });
  const headers = {
    Authorization: `Bearer ${tok.token}`,
    'Content-Type': 'application/json',
  };

  if (existingId) {
    const patch: Record<string, unknown> = {
      displayName: input.display_name,
      jobTitle: input.job_title || undefined,
      department: input.department || undefined,
    };
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(existingId)}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify(patch),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        pending: true,
        detail: `Graph user update HTTP ${res.status}: ${text.slice(0, 160)}`,
        graph_user_id: existingId,
      };
    }
    // Best-effort group/SKU assign
    await assignGraphGroupMembership({ user_id: existingId, email });
    await assignGraphLicenseSku({ user_id: existingId, email });
    return {
      ok: true,
      updated: true,
      graph_user_id: existingId,
      detail: `Updated existing Graph user ${email}`,
    };
  }

  const nick =
    input.mail_nickname?.trim() ||
    email.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64);
  const tempPassword =
    process.env.MS_GRAPH_JOINER_TEMP_PASSWORD?.trim() ||
    `Tmp!${Math.random().toString(36).slice(2, 10)}A1`;

  const domain =
    process.env.MS_GRAPH_JOINER_DOMAIN?.trim() || email.split('@')[1];
  const upn = email.includes(domain) ? email : `${nick}@${domain}`;

  const body = {
    accountEnabled: true,
    displayName: input.display_name,
    mailNickname: nick,
    userPrincipalName: upn,
    jobTitle: input.job_title || undefined,
    department: input.department || undefined,
    passwordProfile: {
      forceChangePasswordNextSignIn: true,
      password: tempPassword,
    },
  };

  const res = await fetch('https://graph.microsoft.com/v1.0/users', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      ok: false,
      pending: true,
      detail: `Graph user create HTTP ${res.status}: ${text.slice(0, 180)}. Confirm User.ReadWrite.All.`,
    };
  }
  const json = (await res.json()) as { id?: string };
  const graphUserId = json.id;
  if (graphUserId) {
    await assignGraphGroupMembership({ user_id: graphUserId, email: upn });
    await assignGraphLicenseSku({ user_id: graphUserId, email: upn });
  }
  return {
    ok: true,
    created: true,
    graph_user_id: graphUserId,
    detail: `Created Graph user ${upn}${graphUserId ? ` (${graphUserId})` : ''}`,
  };
}


