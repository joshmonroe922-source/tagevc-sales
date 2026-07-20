import { createClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/types';
import {
  APP_ROLES,
  type AppRole,
  roleHasPermission,
  type Permission,
} from '@/lib/types/roles';

const DEV_PROFILE: Profile = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'joshmonroe@tagevc.com',
  full_name: 'Josh Monroe',
  role: 'visionary',
  entity_id: 'ENT-FIRM',
  avatar_url: null,
  active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export async function getSessionUser() {
  if (
    process.env.DEV_BYPASS_AUTH === '1' &&
    process.env.NODE_ENV !== 'production' &&
    process.env.VERCEL_ENV !== 'production'
  ) {
    return { id: DEV_PROFILE.id, email: DEV_PROFILE.email };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function getProfile(): Promise<Profile | null> {
  if (
    process.env.DEV_BYPASS_AUTH === '1' &&
    process.env.NODE_ENV !== 'production' &&
    process.env.VERCEL_ENV !== 'production'
  ) {
    return DEV_PROFILE;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    console.error('profiles lookup failed', error.message);
  }

  if (data) {
    const profile = data as Profile;
    if (!profile.active) return null;
    return profile;
  }

  // Bootstrap a row for first login if the trigger missed this user.
  const bootstrap = {
    id: user.id,
    email: user.email ?? '',
    full_name:
      user.user_metadata?.full_name ??
      user.user_metadata?.name ??
      user.email?.split('@')[0] ??
      null,
    role: (normalizeRole(user.user_metadata?.role) ?? 'associate') as AppRole,
    entity_id: null,
    avatar_url: user.user_metadata?.avatar_url ?? null,
    active: true,
  };

  const { data: inserted, error: insertError } = await supabase
    .from('profiles')
    .upsert(bootstrap, { onConflict: 'id' })
    .select('*')
    .maybeSingle();

  if (insertError) {
    console.error('profiles bootstrap failed', insertError.message);
  }

  if (inserted) return inserted as Profile;

  return {
    ...bootstrap,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function normalizeRole(value: unknown): AppRole | null {
  if (typeof value !== 'string') return null;
  const v = value.toLowerCase().replace(/[\s/-]+/g, '_');
  if ((APP_ROLES as readonly string[]).includes(v)) return v as AppRole;
  const aliases: Record<string, AppRole> = {
    vc_sourcer: 'associate',
    associate_vc_sourcer: 'associate',
    coo_subsidiaries: 'coo',
    counsel: 'counsel_ops',
    ops: 'counsel_ops',
  };
  return aliases[v] ?? null;
}

export async function requirePermission(permission: Permission) {
  const profile = await getProfile();
  if (!profile || !roleHasPermission(profile.role, permission)) {
    throw new Error('Forbidden');
  }
  return profile;
}

/** Soft permission check for server actions (returns error string). */
export async function guardPermission(
  permission: Permission,
): Promise<{ ok: true; profile: Profile } | { ok: false; error: string }> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: 'Not signed in' };
  if (!roleHasPermission(profile.role, permission)) {
    return { ok: false, error: 'You do not have permission for this action' };
  }
  return { ok: true, profile };
}
