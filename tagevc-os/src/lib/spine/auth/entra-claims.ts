/**
 * Entra → Supabase JWT claims for graph RLS (C2).
 *
 * Target custom claims on access token:
 *   entra_oid, org_ids[], active_org_id, roles[], is_tage_admin
 *
 * Until Supabase Auth Hook is wired in project settings, we derive claims
 * server-side from memberships + OS profile for Next.js route authz.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';

export type SpineJwtClaims = {
  entra_oid: string | null;
  org_ids: string[];
  active_org_id: string | null;
  roles: string[];
  is_tage_admin: boolean;
};

export const SPINE_ORG_SLUG_BY_ENTITY: Record<string, string> = {
  'ENT-FIRM': 'tage',
  'ENT-R619': 'recruit619',
  'ENT-SIGNENT': 'signent',
  'ENT-INDA': 'instant_nda',
};

/** Map OS entity_id → spine organizations.id (uuid). */
export async function resolveSpineOrgIdForEntity(
  entityId: string | null | undefined,
): Promise<string | null> {
  const slug = SPINE_ORG_SLUG_BY_ENTITY[entityId || ''] || 'tage';
  try {
    const sb = await createPersistClient();
    const { data } = await sb
      .from('organizations')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    return data?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Build claims for a user identified by Entra OID and/or email.
 * Used by Auth Hook when ready; also callable from server actions for tests.
 */
export async function buildSpineClaimsForUser(input: {
  entraOid?: string | null;
  email?: string | null;
  isTageAdmin?: boolean;
  activeOrgSlug?: string | null;
}): Promise<SpineJwtClaims> {
  const empty: SpineJwtClaims = {
    entra_oid: input.entraOid ?? null,
    org_ids: [],
    active_org_id: null,
    roles: [],
    is_tage_admin: Boolean(input.isTageAdmin),
  };

  try {
    const sb = await createPersistClient();
    let profileId: string | null = null;

    if (input.entraOid) {
      const { data } = await sb
        .from('user_profiles')
        .select('id, is_tage_admin, entra_oid')
        .eq('entra_oid', input.entraOid)
        .maybeSingle();
      if (data) {
        profileId = data.id;
        empty.is_tage_admin = Boolean(data.is_tage_admin) || empty.is_tage_admin;
        empty.entra_oid = data.entra_oid;
      }
    }

    if (!profileId && input.email) {
      const { data } = await sb
        .from('user_profiles')
        .select('id, is_tage_admin, entra_oid')
        .ilike('email', input.email)
        .maybeSingle();
      if (data) {
        profileId = data.id;
        empty.is_tage_admin = Boolean(data.is_tage_admin) || empty.is_tage_admin;
        empty.entra_oid = data.entra_oid;
      }
    }

    if (!profileId) return empty;

    const { data: memberships } = await sb
      .from('memberships')
      .select('org_id, role, status')
      .eq('user_id', profileId)
      .eq('status', 'active');

    const orgIds = (memberships ?? []).map((m) => String(m.org_id));
    empty.org_ids = orgIds;
    empty.roles = [
      ...new Set((memberships ?? []).map((m) => String(m.role))),
    ];

    if (input.activeOrgSlug) {
      const { data: org } = await sb
        .from('organizations')
        .select('id')
        .eq('slug', input.activeOrgSlug)
        .maybeSingle();
      if (org?.id && (empty.is_tage_admin || orgIds.includes(org.id))) {
        empty.active_org_id = org.id;
      }
    }
    if (!empty.active_org_id && orgIds[0]) {
      empty.active_org_id = orgIds[0];
    }

    return empty;
  } catch {
    return empty;
  }
}

/**
 * Ensure OS visionary/admin has memberships on all seeded spine orgs.
 * Idempotent bootstrap after phase94 seed.
 */
export async function ensureAdminMemberships(input: {
  email: string;
  entraOid: string;
  displayName?: string;
}): Promise<{ ok: true; orgCount: number } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const { data: profile, error: pErr } = await sb
      .from('user_profiles')
      .upsert(
        {
          entra_oid: input.entraOid,
          email: input.email.toLowerCase(),
          display_name: input.displayName || input.email,
          is_tage_admin: true,
        },
        { onConflict: 'entra_oid' },
      )
      .select('id')
      .single();
    if (pErr || !profile) {
      return { ok: false, error: pErr?.message || 'profile upsert failed' };
    }

    const { data: orgs } = await sb.from('organizations').select('id');
    let n = 0;
    for (const org of orgs ?? []) {
      const { error } = await sb.from('memberships').upsert(
        {
          org_id: org.id,
          user_id: profile.id,
          role: 'org_admin',
          status: 'active',
        },
        { onConflict: 'org_id,user_id' },
      );
      if (!error) n += 1;
    }
    return { ok: true, orgCount: n };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'ensure memberships failed',
    };
  }
}
