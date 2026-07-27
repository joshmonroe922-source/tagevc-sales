/**
 * Live Look server: search users, start/stop sessions, load target profile.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { createClient } from '@/lib/supabase/server';
import { writeAuditEvent } from '@/lib/audit/write';
import {
  clearLiveLookCookie,
  setLiveLookCookie,
  type LiveLookTarget,
} from '@/lib/live-look/cookie';
import { canUseLiveLook, isLiveLookOperator } from '@/lib/live-look/access';
import { entityDisplayName } from '@/lib/entities/display-name';
import type { Profile } from '@/lib/types';
import { APP_ROLES, type AppRole } from '@/lib/types/roles';

export type LiveLookUserRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  entity_id: string | null;
  company_name: string;
  active: boolean;
};

export async function searchProfilesForLiveLook(
  query: string,
  limit = 25,
): Promise<LiveLookUserRow[]> {
  try {
    const sb = await createPersistClient();
    const q = query.trim();
    let req = sb
      .from('profiles')
      .select('id, email, full_name, role, entity_id, active')
      .eq('active', true)
      .order('full_name', { ascending: true })
      .limit(limit);

    if (q) {
      req = req.or(
        `email.ilike.%${q}%,full_name.ilike.%${q}%`,
      );
    }

    const { data, error } = await req;
    if (error) {
      console.error('searchProfilesForLiveLook', error.message);
      return [];
    }
    return (data ?? []).map((p) => ({
      id: String(p.id),
      email: String(p.email ?? ''),
      full_name: (p.full_name as string) ?? null,
      role: String(p.role ?? 'associate'),
      entity_id: (p.entity_id as string) ?? null,
      company_name: entityDisplayName(p.entity_id as string | null),
      active: p.active !== false,
    }));
  } catch {
    return [];
  }
}

export async function loadLiveLookTarget(
  profileId: string,
): Promise<LiveLookTarget | null> {
  try {
    const sb = await createClient();
    const { data } = await sb
      .from('profiles')
      .select('id, email, full_name, role, entity_id, active')
      .eq('id', profileId)
      .maybeSingle();
    if (!data || data.active === false) return null;
    return {
      profileId: String(data.id),
      email: String(data.email ?? ''),
      fullName: (data.full_name as string) ?? null,
      role: String(data.role ?? 'associate'),
      entityId: (data.entity_id as string) ?? null,
    };
  } catch {
    return null;
  }
}

export async function startLiveLookSession(input: {
  viewer: Profile;
  targetProfileId: string;
}): Promise<{ ok: true; target: LiveLookTarget } | { ok: false; error: string }> {
  if (
    !canUseLiveLook({
      email: input.viewer.email,
      realRole: input.viewer.role,
      effectiveRole: input.viewer.role,
    })
  ) {
    return {
      ok: false,
      error: 'Live Look is restricted to the Visionary operator',
    };
  }
  const target = await loadLiveLookTarget(input.targetProfileId);
  if (!target) return { ok: false, error: 'User not found or inactive' };
  if (target.profileId === input.viewer.id) {
    return { ok: false, error: 'Cannot Live Look yourself' };
  }

  try {
    const sb = await createPersistClient();
    // End any open session for this viewer
    await sb
      .from('os_live_look_sessions')
      .update({
        ended_at: new Date().toISOString(),
        end_reason: 'replaced',
      })
      .eq('viewer_profile_id', input.viewer.id)
      .is('ended_at', null);

    await sb.from('os_live_look_sessions').insert({
      viewer_profile_id: input.viewer.id,
      viewer_email: input.viewer.email,
      target_profile_id: target.profileId,
      target_email: target.email,
      target_name: target.fullName,
      target_entity_id: target.entityId,
      detail: { read_only: true, notified_target: false },
    });
  } catch (e) {
    console.error('startLiveLookSession persist', e);
  }

  await setLiveLookCookie(target.profileId);

  await writeAuditEvent({
    action: 'live_look_start',
    title: `Live Look started · ${target.fullName || target.email}`,
    object_type: 'profile',
    object_id: target.profileId,
    entity_id: target.entityId,
    metadata: {
      target_email: target.email,
      target_role: target.role,
      notified_target: false,
      read_only: true,
    },
    mirrorActivity: { module: 'system', action: 'live_look_start' },
  });

  return { ok: true, target };
}

export async function stopLiveLookSession(input: {
  viewer: Profile;
  reason?: 'exit' | 'sign_out' | 'expire';
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (
    !isLiveLookOperator({
      email: input.viewer.email,
      realRole: input.viewer.role,
    })
  ) {
    return {
      ok: false,
      error: 'Live Look is restricted to the Visionary operator',
    };
  }
  let targetEmail: string | null = null;
  let targetId: string | null = null;
  let entityId: string | null = null;

  try {
    const sb = await createPersistClient();
    const { data: open } = await sb
      .from('os_live_look_sessions')
      .select('session_id, target_profile_id, target_email, target_entity_id')
      .eq('viewer_profile_id', input.viewer.id)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (open) {
      targetId = String(open.target_profile_id);
      targetEmail = (open.target_email as string) ?? null;
      entityId = (open.target_entity_id as string) ?? null;
      await sb
        .from('os_live_look_sessions')
        .update({
          ended_at: new Date().toISOString(),
          end_reason: input.reason ?? 'exit',
        })
        .eq('session_id', open.session_id);
    }
  } catch (e) {
    console.error('stopLiveLookSession', e);
  }

  await clearLiveLookCookie();

  await writeAuditEvent({
    action: 'live_look_stop',
    title: `Live Look ended · ${targetEmail ?? 'session'}`,
    object_type: 'profile',
    object_id: targetId,
    entity_id: entityId,
    metadata: {
      reason: input.reason ?? 'exit',
      notified_target: false,
    },
    mirrorActivity: { module: 'system', action: 'live_look_stop' },
  });

  return { ok: true };
}

/** Apply Live Look target onto session profile for read UI (role + entity scope). */
export function applyLiveLookToProfile(
  real: Profile,
  target: LiveLookTarget,
): Profile {
  const raw = target.role.toLowerCase().replace(/[\s/-]+/g, '_');
  const role = (
    (APP_ROLES as readonly string[]).includes(raw) ? raw : real.role
  ) as AppRole;
  return {
    ...real,
    // Keep viewer's id for audit of who is looking; display uses liveLookTarget.
    role,
    entity_id: target.entityId,
  };
}
