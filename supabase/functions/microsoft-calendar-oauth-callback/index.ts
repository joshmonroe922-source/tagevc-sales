import {
  encryptSecret,
  exchangeCodeForTokens,
  fetchMe,
  getMsConfig,
  portalBaseUrl,
} from '../_shared/microsoftGraph.ts';
import { ensurePortalVault } from '../_shared/documentVault.ts';
import { auditMsAction } from '../_shared/msAudit.ts';
import { createServiceClient } from '../_shared/supabase.ts';

function redirect(to: string, status = 302): Response {
  return new Response(null, {
    status,
    headers: { Location: to },
  });
}

function portalRedirect(
  path: string,
  params: Record<string, string>,
): Response {
  const base = portalBaseUrl();
  const url = new URL(path.startsWith('/') ? path : `/${path}`, `${base}/`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return redirect(url.toString());
}

Deno.serve(async (req) => {
  // Browser redirect from Microsoft — no JWT, no CORS JSON.
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');
  const errorDesc = url.searchParams.get('error_description');

  if (oauthError) {
    return portalRedirect('/sales/calendar', {
      calendar_error: errorDesc || oauthError,
    });
  }

  if (!code || !state) {
    return portalRedirect('/sales/calendar', {
      calendar_error: 'Missing OAuth code or state',
    });
  }

  try {
    const config = getMsConfig();
    if (!config.configured) {
      return portalRedirect('/sales/calendar', {
        calendar_error: 'Microsoft Graph is not configured on the server',
      });
    }

    const service = createServiceClient();

    const { data: stateRow, error: stateErr } = await service
      .from('microsoft_oauth_states')
      .select('id, sales_user_id, redirect_path, expires_at')
      .eq('state_token', state)
      .maybeSingle();

    if (stateErr || !stateRow) {
      return portalRedirect('/sales/calendar', {
        calendar_error: 'Invalid or expired OAuth state',
      });
    }

    if (new Date(stateRow.expires_at).getTime() < Date.now()) {
      await service.from('microsoft_oauth_states').delete().eq('id', stateRow.id);
      return portalRedirect('/sales/calendar', {
        calendar_error: 'OAuth state expired — try Connect again',
      });
    }

    const tokens = await exchangeCodeForTokens(config, code);
    const me = await fetchMe(tokens.access_token);
    const msEmail = (
      me.mail ||
      me.userPrincipalName ||
      ''
    )
      .trim()
      .toLowerCase();

    const accessEnc = await encryptSecret(
      tokens.access_token,
      config.encryptionKey,
    );
    if (!tokens.refresh_token) {
      return portalRedirect(stateRow.redirect_path || '/sales/calendar', {
        calendar_error:
          'Microsoft did not return a refresh token. Ensure offline_access scope is granted.',
      });
    }
    const refreshEnc = await encryptSecret(
      tokens.refresh_token,
      config.encryptionKey,
    );
    const tokenExpiresAt = new Date(
      Date.now() + (tokens.expires_in ?? 3600) * 1000,
    ).toISOString();
    const now = new Date().toISOString();

    const { error: upsertErr } = await service
      .from('microsoft_calendar_connections')
      .upsert(
        {
          sales_user_id: stateRow.sales_user_id,
          microsoft_email: msEmail || null,
          microsoft_user_id: me.id ?? null,
          access_token_enc: accessEnc,
          refresh_token_enc: refreshEnc,
          token_expires_at: tokenExpiresAt,
          scopes: tokens.scope ?? '',
          connected_at: now,
          last_synced_at: now,
          last_error: null,
          updated_at: now,
        },
        { onConflict: 'sales_user_id' },
      );

    await service.from('microsoft_oauth_states').delete().eq('id', stateRow.id);

    // Best-effort: if work_email empty, set from Microsoft mailbox
    if (msEmail) {
      await service
        .from('sales_users')
        .update({ work_email: msEmail })
        .eq('id', stateRow.sales_user_id)
        .is('work_email', null);
    }

    if (upsertErr) {
      console.error('calendar upsert', upsertErr);
      return portalRedirect(stateRow.redirect_path || '/sales/calendar', {
        calendar_error: upsertErr.message || 'Failed to save connection',
      });
    }

    const { data: salesRow } = await service
      .from('sales_users')
      .select('email')
      .eq('id', stateRow.sales_user_id)
      .maybeSingle();

    await auditMsAction(service, {
      userId: stateRow.sales_user_id,
      email: salesRow?.email ?? msEmail ?? '',
      eventType: 'calendar_connect',
      path: stateRow.redirect_path || '/sales/calendar',
      metadata: {
        microsoft_email: msEmail || null,
        scopes: tokens.scope ?? '',
      },
    });

    // Best-effort: create Tage Portal/Downloads (+ company Resumes if configured)
    try {
      const vault = await ensurePortalVault(tokens.access_token, tokens.scope ?? null);
      await auditMsAction(service, {
        userId: stateRow.sales_user_id,
        email: salesRow?.email ?? msEmail ?? '',
        eventType: 'files_vault_ensure',
        path: stateRow.redirect_path || '/sales/files',
        metadata: {
          source: 'oauth_callback',
          downloads_id: vault.downloads.item_id,
          company_available: vault.company.available,
          company_mode: vault.company.mode,
        },
      });
    } catch (vaultErr) {
      console.warn('oauth ensurePortalVault', vaultErr);
    }

    return portalRedirect(stateRow.redirect_path || '/sales/calendar', {
      calendar_connected: '1',
    });
  } catch (err) {
    console.error('microsoft-calendar-oauth-callback', err);
    return portalRedirect('/sales/calendar', {
      calendar_error:
        err instanceof Error ? err.message : 'OAuth callback failed',
    });
  }
});
