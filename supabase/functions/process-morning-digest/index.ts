import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { processMorningDigests } from '../_shared/morningDigest.ts';
import { createServiceClient, createUserClient } from '../_shared/supabase.ts';

type Body = {
  dry_run?: boolean;
  force?: boolean;
  /** Portal login email — limit to one user (useful with force/dry_run). */
  email?: string;
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
    const cronSecret = Deno.env.get('DIGEST_CRON_SECRET');
    const headerSecret = req.headers.get('x-digest-secret');
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

    let body: Body = {};
    try {
      body = (await req.json()) as Body;
    } catch {
      body = {};
    }

    const result = await processMorningDigests({
      dryRun: Boolean(body.dry_run),
      force: Boolean(body.force),
      email: body.email?.trim() || null,
    });

    return jsonResponse({ ok: true, ...result }, 200, origin);
  } catch (err) {
    console.error('process-morning-digest error', err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Unexpected error' },
      500,
      origin,
    );
  }
});
