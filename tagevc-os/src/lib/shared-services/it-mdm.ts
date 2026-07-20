/**
 * MDM / Intune lifecycle hooks (Phases 25–27).
 * Prefer Microsoft Graph Intune when MS_GRAPH_* is set; also posts MDM_WEBHOOK_URL.
 */

type MdmResult = { ok: boolean; skipped?: boolean; detail: string };

function graphConfigured(): boolean {
  return Boolean(
    process.env.MS_GRAPH_TENANT_ID?.trim() &&
      process.env.MS_GRAPH_CLIENT_ID?.trim() &&
      process.env.MS_GRAPH_CLIENT_SECRET?.trim(),
  );
}

async function getMsGraphToken(): Promise<
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
    const devicesRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(graphUserId)}/managedDevices?$select=id,deviceName,operatingSystem,managementState`,
      { headers },
    );
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
        deviceName?: string;
        operatingSystem?: string;
        managementState?: string;
      }>;
    };
    const devices = devicesJson.value ?? [];
    const summary =
      devices.length === 0
        ? '0 managed devices'
        : devices
            .slice(0, 5)
            .map(
              (d) =>
                `${d.deviceName || d.id}${d.operatingSystem ? ` (${d.operatingSystem})` : ''}`,
            )
            .join(', ');

    const autoRetire =
      process.env.INTUNE_AUTO_RETIRE === '1' ||
      process.env.INTUNE_AUTO_RETIRE === 'true';

    if (input.action === 'offboard' && autoRetire && devices.length > 0) {
      const retireResults: string[] = [];
      for (const d of devices.slice(0, 10)) {
        if (!d.id) continue;
        const retire = await fetch(
          `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/${encodeURIComponent(d.id)}/retire`,
          { method: 'POST', headers },
        );
        retireResults.push(
          retire.ok
            ? `retired ${d.deviceName || d.id}`
            : `retire fail ${d.id}:${retire.status}`,
        );
      }
      return {
        ok: retireResults.every((r) => r.startsWith('retired')),
        detail: `Intune offboard · ${retireResults.join('; ')}`,
      };
    }

    return {
      ok: true,
      detail: `Intune ${input.action} · ${summary}${
        input.action === 'offboard' && !autoRetire
          ? ' · set INTUNE_AUTO_RETIRE=1 to retire'
          : ''
      }`,
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
  const anyOk = (!graph.skipped && graph.ok) || (!webhook.skipped && webhook.ok);
  return {
    ok: anyOk,
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
    if (res.ok || res.status === 400) {
      // 400 often means already a member
      results.push(res.ok ? `added ${gid.slice(0, 8)}…` : `exists ${gid.slice(0, 8)}…`);
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
