import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import {
  getMsConfig,
  getValidAccessToken,
  requireActiveSalesUser,
  scopesInclude,
  suggestLocations,
} from '../_shared/microsoftGraph.ts';
import { auditMsAction } from '../_shared/msAudit.ts';
import { createServiceClient, createUserClient } from '../_shared/supabase.ts';

type Body = {
  q?: string;
  query?: string;
  top?: number;
};

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
        { error: 'Microsoft Graph is not configured', configured: false },
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

    const body = (await req.json().catch(() => ({}))) as Body;
    const q = (body.q ?? body.query ?? '').trim();

    const { data: conn } = await service
      .from('microsoft_calendar_connections')
      .select('scopes')
      .eq('sales_user_id', salesUser.id)
      .maybeSingle();
    const granted = conn?.scopes ?? '';
    const canCalendar =
      scopesInclude(granted, 'Calendars.ReadWrite') ||
      scopesInclude(granted, 'Calendars.Read');
    const canRooms = scopesInclude(granted, 'Place.Read.All');

    if (!canCalendar && !canRooms) {
      return jsonResponse(
        {
          error: 'Location suggestions require calendar access',
          needs_reconnect: true,
          locations: [],
        },
        403,
        origin,
      );
    }

    let accessToken: string;
    try {
      const result = await getValidAccessToken(service, config, salesUser.id);
      accessToken = result.accessToken;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Not connected';
      return jsonResponse({ error: message, needs_reconnect: true }, 401, origin);
    }

    const locations = await suggestLocations(accessToken, q, {
      includeRooms: canRooms,
      top: typeof body.top === 'number' ? body.top : 10,
    });

    await auditMsAction(service, {
      userId: salesUser.id,
      email: salesUser.email,
      eventType: 'location_suggest',
      path: '/sales/calendar',
      metadata: {
        query_len: q.length,
        result_count: locations.length,
        rooms: canRooms,
      },
    });

    return jsonResponse(
      {
        locations,
        query: q,
        rooms_enabled: canRooms,
      },
      200,
      origin,
    );
  } catch (err) {
    console.error('microsoft-calendar-location-suggest', err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Location suggest failed' },
      500,
      origin,
    );
  }
});
