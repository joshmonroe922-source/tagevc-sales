import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { processDueDrips } from '../_shared/drips.ts';
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
    const cronSecret = Deno.env.get('DRIP_CRON_SECRET');
    const headerSecret = req.headers.get('x-drip-secret');
    const authHeader = req.headers.get('Authorization');

    let authorized = false;

    if (cronSecret && headerSecret && headerSecret === cronSecret) {
      authorized = true;
    } else if (authHeader?.startsWith('Bearer ')) {
      const userClient = createUserClient(authHeader);
      const {
        data: { user },
      } = await userClient.auth.getUser();
      if (user?.email) {
        const service = createServiceClient();
        const { data: salesUser } = await service
          .from('sales_users')
          .select('role, active')
          .eq('email', user.email.toLowerCase())
          .eq('active', true)
          .maybeSingle();
        if (salesUser && ['admin', 'manager'].includes(salesUser.role)) {
          authorized = true;
        }
      }
    }

    if (!authorized) {
      return jsonResponse({ error: 'Unauthorized' }, 401, origin);
    }

    const supabase = createServiceClient();
    const result = await processDueDrips(supabase);
    return jsonResponse({ ok: true, ...result }, 200, origin);
  } catch (err) {
    console.error(err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Unexpected error' },
      500,
      origin,
    );
  }
});
