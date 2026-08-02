/**
 * Optional HTTP Custom Access Token hook (alternative to Postgres hook).
 * Prefer phase95_spine_claims_hook.sql Postgres function in Dashboard.
 *
 * Deploy: supabase functions deploy spine-claims --no-verify-jwt
 * Then point Auth Hook URL at this function.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const payload = await req.json();
    const claims = { ...(payload.claims ?? {}) };
    const email = String(claims.email || claims.user_metadata?.email || '')
      .toLowerCase()
      .trim();
    const entra = String(
      claims.oid ||
        claims.user_metadata?.oid ||
        claims.app_metadata?.provider_id ||
        claims.sub ||
        '',
    ).trim();

    const url = Deno.env.get('SUPABASE_URL')!;
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb = createClient(url, key, { auth: { persistSession: false } });

    let profile: {
      id: string;
      is_tage_admin: boolean;
      entra_oid: string;
    } | null = null;

    if (entra) {
      const { data } = await sb
        .from('user_profiles')
        .select('id, is_tage_admin, entra_oid')
        .eq('entra_oid', entra)
        .maybeSingle();
      profile = data;
    }
    if (!profile && email) {
      const { data } = await sb
        .from('user_profiles')
        .select('id, is_tage_admin, entra_oid')
        .ilike('email', email)
        .maybeSingle();
      profile = data;
    }

    let org_ids: string[] = [];
    let roles: string[] = [];
    let is_tage_admin = false;

    if (profile) {
      is_tage_admin = Boolean(profile.is_tage_admin);
      const { data: mem } = await sb
        .from('memberships')
        .select('org_id, role')
        .eq('user_id', profile.id)
        .eq('status', 'active');
      org_ids = (mem ?? []).map((m) => String(m.org_id));
      roles = [...new Set((mem ?? []).map((m) => String(m.role)))];
      claims.entra_oid = profile.entra_oid;
    }

    claims.org_ids = org_ids;
    claims.roles = roles;
    claims.is_tage_admin = is_tage_admin;
    if (org_ids[0]) claims.active_org_id = org_ids[0];

    return Response.json({ claims });
  } catch (e) {
    console.error(e);
    // Fail open — return empty augmentation
    return Response.json({ claims: {} });
  }
});
