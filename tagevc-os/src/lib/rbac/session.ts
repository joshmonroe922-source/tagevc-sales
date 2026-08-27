import { cache } from 'react';

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
import { applyLiveLookToProfile } from '@/lib/live-look/server';
import {
  isJoshMonroeLiveLookEmail,
  liveLookViewerMode,
} from '@/lib/live-look/access';
import { canSwitchEntityOs } from '@/lib/rbac/entity-os';
import { readEntityOsCookie } from '@/lib/rbac/entity-os-cookie';
import { resolveSubsidiaryLeaderEntityId } from '@/lib/entities/assignment-lead';
import {
  isJoshMonroeEmail,
  isLaurenMonroeEmail,
  JOSH_MONROE_JOB_TITLE,
  staffJobTitleForEmail,
} from '@/lib/org/staff-titles';

/** Columns SessionContext / Profile actually use — avoid select('*'). */
export const PROFILE_SESSION_COLUMNS =
  'id, email, full_name, role, entity_id, avatar_url, active, job_title, manager_profile_id, created_at, updated_at';

const DEV_PROFILE: Profile = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'joshmonroe@tagevc.com',
  full_name: 'Josh Monroe',
  role: 'visionary',
  entity_id: 'ENT-FIRM',
  avatar_url: null,
  job_title: JOSH_MONROE_JOB_TITLE,
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
  /** Active Live Look target. Null when not observing. */
  liveLookTarget: LiveLookTarget | null;
  /** True when Live Look is active — all writes must be denied. */
  liveLookActive: boolean;
  /**
   * Subsidiary OS the firm-wide operator is working inside (Entity OS
   * switcher). Null = parent OS / firm-wide. Narrows scope only.
   */
  activeEntityOs: string | null;
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
export const getRealProfile = cache(async function getRealProfile(): Promise<Profile | null> {
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
    .select(PROFILE_SESSION_COLUMNS)
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    console.error('profiles lookup failed', error.message);
  }

  if (data) {
    const profile = data as Profile;
    if (!profile.active) return null;
    const canonical = staffJobTitleForEmail(profile.email, null);
    // Keep Josh / Lauren display titles canonical when profile row drifts.
    if (
      canonical &&
      (profile.job_title ?? '').trim() !== canonical &&
      (isJoshMonroeEmail(profile.email) ||
        (isLaurenMonroeEmail(profile.email) &&
          !(profile.job_title ?? '').trim()))
    ) {
      const patched = {
        ...profile,
        job_title: canonical,
      };
      void supabase
        .from('profiles')
        .update({ job_title: canonical })
        .eq('id', profile.id);
      return patched;
    }
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
    job_title: staffJobTitleForEmail(user.email, null),
    active: true,
  };

  const { data: inserted, error: insertError } = await supabase
    .from('profiles')
    .upsert(bootstrap, { onConflict: 'id' })
    .select(PROFILE_SESSION_COLUMNS)
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
});

/**
 * Session with optional Visionary role impersonation or Live Look applied.
 * Role Switcher cookies are only honored for real Visionary.
 * Live Look: Visionary Josh (full tenant) or Think Tank (excludes Josh).
 * Live Look and Role Switcher may coexist for Think Tank preview; Live Look
 * wins for the effective profile.
 */
export const getSessionContext = cache(async function getSessionContext(): Promise<SessionContext | null> {
  const real = await getRealProfile();
  if (!real) return null;

  const realRole = real.role;
  let impersonatingAs: AppRole | null = null;
  let liveLookTarget: LiveLookTarget | null = null;

  if (realRole === 'visionary') {
    impersonatingAs = await readImpersonationCookie();
  }

  const operatorMode = liveLookViewerMode({
    email: real.email,
    realRole,
    // While holding a Live Look cookie, effective role is the target — use
    // impersonation / real role to decide operator eligibility.
    effectiveRole: impersonatingAs ?? realRole,
    impersonatingAs,
  });

  if (operatorMode) {
    const liveId = await readLiveLookCookie();
    if (liveId) {
      const { loadLiveLookTarget } = await import('@/lib/live-look/server');
      liveLookTarget = await loadLiveLookTarget(liveId, operatorMode);
      if (!liveLookTarget) {
        try {
          const { clearLiveLookCookie } = await import('@/lib/live-look/cookie');
          await clearLiveLookCookie();
        } catch {
          /* ignore */
        }
      } else if (
        operatorMode === 'think_tank_scoped' &&
        isJoshMonroeLiveLookEmail(liveLookTarget.email)
      ) {
        liveLookTarget = null;
        try {
          const { clearLiveLookCookie } = await import('@/lib/live-look/cookie');
          await clearLiveLookCookie();
        } catch {
          /* ignore */
        }
      }
    }
  } else {
    try {
      const liveId = await readLiveLookCookie();
      if (liveId) {
        const { clearLiveLookCookie } = await import('@/lib/live-look/cookie');
        await clearLiveLookCookie();
      }
    } catch {
      /* ignore */
    }
  }

  const liveLookActive = Boolean(liveLookTarget);

  let profile: Profile = liveLookTarget
    ? applyLiveLookToProfile(real, liveLookTarget)
    : impersonatingAs
      ? { ...real, role: impersonatingAs }
      : real;

  if (profile.role === 'sub_lead') {
    profile = {
      ...profile,
      entity_id: resolveSubsidiaryLeaderEntityId(profile.entity_id),
    };
  }

  // Entity OS switcher: firm-wide Visionary working inside a subsidiary OS.
  // Role is unchanged (still Visionary) — only entity scope + shell branding
  // narrow, so this can never widen access beyond the real profile.
  let activeEntityOs: string | null = null;
  if (canSwitchEntityOs({ realRole, impersonatingAs, liveLookActive })) {
    activeEntityOs = await readEntityOsCookie();
    if (activeEntityOs) {
      profile = { ...profile, entity_id: activeEntityOs };
    }
  }

  return {
    profile,
    realRole,
    impersonatingAs,
    liveLookTarget,
    liveLookActive,
    activeEntityOs,
  };
});

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
    finance: 'ssc_finance',
    accounting: 'ssc_finance',
    accounting_and_finance: 'ssc_finance',
    hr: 'ssc_hr',
    human_resources: 'ssc_hr',
    legal: 'ssc_legal',
    it: 'ssc_it',
    technology: 'ssc_it',
    technology_it: 'ssc_it',
    marketing: 'ssc_marketing',
    think_tank: 'think_tank',
    strategic_thinking: 'think_tank',
    vp_think_tank: 'think_tank',
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
): Promise<
  | { ok: true; profile: Profile; activeEntityOs: string | null }
  | { ok: false; error: string }
> {
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
  return { ok: true, profile: ctx.profile, activeEntityOs: ctx.activeEntityOs };
}

/** True when Visionary is actively viewing as another role. */
export async function isImpersonating(): Promise<boolean> {
  const ctx = await getSessionContext();
  return Boolean(ctx?.impersonatingAs);
}
