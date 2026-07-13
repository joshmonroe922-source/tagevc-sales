import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import {
  buildAuthorizeUrl,
  getMsConfig,
  preferredWorkEmail,
  randomStateToken,
  requireActiveSalesUser,
} from '../_shared/microsoftGraph.ts';
import { createServiceClient, createUserClient } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin);
  }

  try {
    const config = getMsConfig();
    if (!config.configured) {
      return jsonResponse(
        {
          error:
            'Microsoft Graph is not configured. Set MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, and MS_GRAPH_REDIRECT_URI (see SETUP_CALENDAR.md).',
          configured: false,
        },
        503,
        origin,
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Unauthorized' }, 401, origin);
    }

    const userClient = createUserClient(authHeader);
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user?.email) {
      return jsonResponse({ error: 'Unauthorized' }, 401, origin);
    }

    const service = createServiceClient();
    const salesUser = await requireActiveSalesUser(service, user.email);
    if (!salesUser) {
      return jsonResponse({ error: 'Forbidden' }, 403, origin);
    }

    let redirectPath = '/sales/calendar';
    try {
      const body = (await req.json()) as { redirect_path?: string };
      if (
        typeof body.redirect_path === 'string' &&
        body.redirect_path.startsWith('/sales/')
      ) {
        redirectPath = body.redirect_path;
      }
    } catch {
      /* empty body ok */
    }

    const state = randomStateToken();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const { error: stateErr } = await service.from('microsoft_oauth_states').insert({
      sales_user_id: salesUser.id,
      state_token: state,
      redirect_path: redirectPath,
      expires_at: expiresAt,
    });

    if (stateErr) {
      return jsonResponse(
        { error: stateErr.message ?? 'Failed to start OAuth' },
        500,
        origin,
      );
    }

    const loginHint = preferredWorkEmail(salesUser);
    const url = buildAuthorizeUrl({
      config,
      state,
      loginHint,
    });

    return jsonResponse(
      {
        url,
        login_hint: loginHint,
        configured: true,
      },
      200,
      origin,
    );
  } catch (err) {
    console.error('microsoft-calendar-oauth-start', err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'OAuth start failed' },
      500,
      origin,
    );
  }
});
