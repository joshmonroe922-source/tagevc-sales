import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import {
  getMsConfig,
  preferredWorkEmail,
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

    const config = getMsConfig();
    const { data: conn } = await service
      .from('microsoft_calendar_connections')
      .select(
        'microsoft_email, microsoft_user_id, connected_at, last_synced_at, last_error, token_expires_at, scopes',
      )
      .eq('sales_user_id', salesUser.id)
      .maybeSingle();

    const connected = Boolean(conn?.connected_at && !conn?.last_error?.includes('reconnect'));

    return jsonResponse(
      {
        configured: config.configured,
        connected: Boolean(conn?.connected_at),
        work_email: salesUser.work_email,
        login_email: salesUser.email,
        preferred_work_email: preferredWorkEmail(salesUser),
        microsoft_email: conn?.microsoft_email ?? null,
        connected_at: conn?.connected_at ?? null,
        last_synced_at: conn?.last_synced_at ?? null,
        last_error: conn?.last_error ?? null,
        token_expires_at: conn?.token_expires_at ?? null,
        scopes: conn?.scopes ?? null,
        capabilities: {
          list_events: true,
          create_events: false,
          edit_events: false,
          delete_events: false,
        },
        // Hint for UI when Azure secrets missing
        setup_hint: config.configured
          ? null
          : 'Add MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, MS_GRAPH_REDIRECT_URI, and MS_TOKEN_ENCRYPTION_KEY — see SETUP_CALENDAR.md',
        // Soft signal: connected but may need reauth
        healthy: connected && !conn?.last_error,
      },
      200,
      origin,
    );
  } catch (err) {
    console.error('microsoft-calendar-status', err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Status failed' },
      500,
      origin,
    );
  }
});
