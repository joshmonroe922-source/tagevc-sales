import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { requireActiveSalesUser } from '../_shared/microsoftGraph.ts';
import { auditMsAction } from '../_shared/msAudit.ts';
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

    const { error } = await service
      .from('microsoft_calendar_connections')
      .delete()
      .eq('sales_user_id', salesUser.id);

    if (error) {
      return jsonResponse({ error: error.message }, 500, origin);
    }

    await service
      .from('microsoft_oauth_states')
      .delete()
      .eq('sales_user_id', salesUser.id);

    await auditMsAction(service, {
      userId: salesUser.id,
      email: salesUser.email,
      eventType: 'calendar_disconnect',
      path: '/sales/calendar',
    });

    return jsonResponse({ ok: true }, 200, origin);
  } catch (err) {
    console.error('microsoft-calendar-disconnect', err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Disconnect failed' },
      500,
      origin,
    );
  }
});
