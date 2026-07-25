import { createClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/types';
import {
  APP_ROLES,
  type AppRole,
  roleHasPermission,
  type Permission,
} from '@/lib/types/roles';
import {
  readImpersonationCookie,
  BREAK_GLASS_MESSAGE,
  isBreakGlassPermission,
} from '@/lib/rbac/impersonation';
import {
  readLiveLookCookie,
  LIVE_LOOK_BLOCK_MESSAGE,
  type LiveLookTarget,
} from '@/lib/live-look/cookie';
import {
  applyLiveLookToProfile,
  loadLiveLookTarget,
} from '@/lib/live-look/server';

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

export type SessionContext = {
  /** Profile with effective (possibly impersonated / Live Look) role for UI. */
  profile: Profile;
  /** Role stored on the profile row — never overridden by impersonation. */
  realRole: AppRole;
  /** Active impersonation target, or null. */
  impersonatingAs: AppRole | null;
  /** Active Live Look target (Visionary observation). Null when not observing. */
  liveLookTarget: LiveLookTarget | null;
  /** True when Live Look is active — all writes must be denied. */
  liveLookActive: boolean;
};

function isDevBypass() {
  return (
    process.env.DEV_BYPASS_AUTH === '1' &&
    process.env.NODE_ENV !== 'production' &&
    process.env.VERCEL_ENV !== 'production'
  );
}

export async function getSessionUser() {
  if (isDevBypass()) {
    return { id: DEV_PROFILE.id, email: DEV_PROFILE.email };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Real profile from DB / bootstrap — ignores impersonation cookie. */
export async function getRealProfile(): Promise<Profile | null> {
  if (isDevBypass()) {
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

/**
 * Session with optional Visionary role impersonation or Live Look applied.
 * Cookies are ignored unless the real role is Visionary (security boundary).
 * Live Look and role impersonation are mutually exclusive: Live Look wins if both set.
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const real = await getRealProfile();
  if (!real) return null;

  const realRole = real.role;
  let impersonatingAs: AppRole | null = null;
  let liveLookTarget: LiveLookTarget | null = null;

  if (realRole === 'visionary') {
    const liveId = await readLiveLookCookie();
    if (liveId) {
      liveLookTarget = await loadLiveLookTarget(liveId);
      if (!liveLookTarget) {
        // Stale cookie
        try {
          const { clearLiveLookCookie } = await import('@/lib/live-look/cookie');
          await clearLiveLookCookie();
        } catch {
          /* ignore */
        }
      }
    }
    if (!liveLookTarget) {
      impersonatingAs = await readImpersonationCookie();
    }
  }

  const liveLookActive = Boolean(liveLookTarget);

  const profile: Profile = liveLookTarget
    ? applyLiveLookToProfile(real, liveLookTarget)
    : impersonatingAs
      ? { ...real, role: impersonatingAs }
      : real;

  return {
    profile,
    realRole,
    impersonatingAs,
    liveLookTarget,
    liveLookActive,
  };
}

/** Effective profile (impersonated role when active). Use for UI + permissions. */
export async function getProfile(): Promise<Profile | null> {
  const ctx = await getSessionContext();
  return ctx?.profile ?? null;
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
  const ctx = await getSessionContext();
  if (!ctx) throw new Error('Forbidden');
  if (ctx.liveLookActive) {
    throw new Error(LIVE_LOOK_BLOCK_MESSAGE);
  }
  if (ctx.impersonatingAs && isBreakGlassPermission(permission)) {
    throw new Error(BREAK_GLASS_MESSAGE);
  }
  if (!roleHasPermission(ctx.profile.role, permission)) {
    throw new Error('Forbidden');
  }
  return ctx.profile;
}

/** Soft permission check for server actions (returns error string). */
export async function guardPermission(
  permission: Permission,
): Promise<{ ok: true; profile: Profile } | { ok: false; error: string }> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: 'Not signed in' };
  if (ctx.liveLookActive) {
    return { ok: false, error: LIVE_LOOK_BLOCK_MESSAGE };
  }
  if (ctx.impersonatingAs && isBreakGlassPermission(permission)) {
    return { ok: false, error: BREAK_GLASS_MESSAGE };
  }
  if (!roleHasPermission(ctx.profile.role, permission)) {
    return { ok: false, error: 'You do not have permission for this action' };
  }
  return { ok: true, profile: ctx.profile };
}

/** True when Visionary is actively viewing as another role. */
export async function isImpersonating(): Promise<boolean> {
  const ctx = await getSessionContext();
  return Boolean(ctx?.impersonatingAs);
}
