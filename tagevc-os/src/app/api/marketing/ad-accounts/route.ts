import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardPermission } from '@/lib/rbac/session';
import {
  canAccessEntityId,
  entityScopeDeniedMessage,
} from '@/lib/rbac/entity-scope';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { ensureFreshAccessToken } from '@/lib/shared-services/marketing-token-refresh';
import {
  discoverPaidAdAccounts,
  type OAuthPlatform,
} from '@/lib/shared-services/marketing-oauth';

async function loadConnection(accountId: string) {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_marketing_social_accounts')
    .select('account_id, entity_id, platform, account_type, status')
    .eq('account_id', accountId)
    .maybeSingle();
  return { sb, data, error };
}

async function authorizeConnection(accountId: string) {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return { ok: false as const, error: gate.error, status: 403 };
  const loaded = await loadConnection(accountId);
  if (loaded.error || !loaded.data) {
    return {
      ok: false as const,
      error: loaded.error?.message || 'Connection not found',
      status: 404,
    };
  }
  const entityId = (loaded.data.entity_id as string) ?? null;
  if (
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      entityId,
    )
  ) {
    return {
      ok: false as const,
      error: entityScopeDeniedMessage(entityId || 'firm-wide'),
      status: 403,
    };
  }
  if (
    loaded.data.account_type !== 'paid_ads' ||
    !['facebook', 'linkedin'].includes(String(loaded.data.platform))
  ) {
    return {
      ok: false as const,
      error: 'Connection is not a supported paid-ad account',
      status: 409,
    };
  }
  const token = await ensureFreshAccessToken(accountId);
  if (!token.token) {
    return {
      ok: false as const,
      error: token.error || 'Reconnect OAuth before discovery',
      status: 409,
    };
  }
  return {
    ok: true as const,
    gate,
    sb: loaded.sb,
    account: loaded.data,
    token: token.token,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const accountId = url.searchParams.get('account_id')?.trim() || '';
  if (!accountId) {
    return NextResponse.json({ error: 'account_id required' }, { status: 400 });
  }
  const auth = await authorizeConnection(accountId);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const discovered = await discoverPaidAdAccounts({
    platform: auth.account.platform as OAuthPlatform,
    accessToken: auth.token,
  });
  return NextResponse.json(discovered, { status: discovered.ok ? 200 : 502 });
}

export async function POST(request: Request) {
  const parsed = z
    .object({
      account_id: z.string().min(1),
      external_account_id: z.string().min(1),
    })
    .safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid selection' },
      { status: 400 },
    );
  }
  const auth = await authorizeConnection(parsed.data.account_id);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const discovered = await discoverPaidAdAccounts({
    platform: auth.account.platform as OAuthPlatform,
    accessToken: auth.token,
  });
  if (!discovered.ok) {
    return NextResponse.json({ error: discovered.error }, { status: 502 });
  }
  const selected = discovered.accounts.find(
    (account) =>
      account.externalAccountId === parsed.data.external_account_id,
  );
  if (!selected) {
    return NextResponse.json(
      { error: 'Selected provider account is no longer accessible' },
      { status: 409 },
    );
  }

  let probe: Response;
  if (auth.account.platform === 'facebook') {
    const version = process.env.META_API_VERSION?.trim() || 'v25.0';
    probe = await fetch(
      `https://graph.facebook.com/${version}/${encodeURIComponent(selected.externalAccountId)}/insights?fields=impressions&limit=1`,
      { headers: { Authorization: `Bearer ${auth.token}` } },
    );
  } else {
    const accountUrn = `urn:li:sponsoredAccount:${selected.externalAccountId}`;
    const params = new URLSearchParams({
      q: 'analytics',
      pivot: 'ACCOUNT',
      timeGranularity: 'ALL',
      accounts: `List(${accountUrn})`,
      fields: 'impressions',
    });
    probe = await fetch(
      `https://api.linkedin.com/rest/adAnalytics?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'LinkedIn-Version':
            process.env.LINKEDIN_API_VERSION?.trim() || '202607',
          'X-Restli-Protocol-Version': '2.0.0',
        },
      },
    );
  }
  if (!probe.ok) {
    const detail = (await probe.text().catch(() => '')).slice(0, 180);
    await auth.sb
      .from('os_marketing_social_accounts')
      .update({
        scope_status: 'missing',
        scope_checked_at: new Date().toISOString(),
        scope_error: `Reporting probe HTTP ${probe.status}: ${detail}`,
        status: 'error',
      })
      .eq('account_id', parsed.data.account_id);
    return NextResponse.json(
      { error: `Provider reporting permission check failed (${probe.status})` },
      { status: 409 },
    );
  }
  const now = new Date().toISOString();
  const { error } = await auth.sb
    .from('os_marketing_social_accounts')
    .update({
      external_account_id: selected.externalAccountId,
      display_name: selected.name,
      currency: selected.currency,
      timezone: selected.timezone,
      status: 'connected',
      scope_status: 'healthy',
      scope_checked_at: now,
      scope_error: null,
      selected_at: now,
      verified_at: now,
      connection_meta: {
        provider_role: selected.role,
        discovered_at: now,
      },
      updated_at: now,
    })
    .eq('account_id', parsed.data.account_id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, selected });
}
