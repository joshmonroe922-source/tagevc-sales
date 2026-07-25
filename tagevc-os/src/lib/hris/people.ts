/**
 * Search active profiles for manager assignment / people pickers.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { entityDisplayName } from '@/lib/entities/display-name';
import { APP_ROLE_LABELS, type AppRole } from '@/lib/types/roles';

/** Roles eligible to be assigned as a hiring / direct manager. */
export const MANAGER_ELIGIBLE_ROLES: readonly AppRole[] = [
  'visionary',
  'admin',
  'partner',
  'associate',
  'coo',
  'counsel_ops',
  'service_lead',
  'sub_lead',
] as const;

export type PeoplePickerRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
  role_label: string;
  entity_id: string | null;
  company_name: string;
  active: boolean;
};

export async function searchManagerCandidates(
  query: string,
  limit = 20,
): Promise<PeoplePickerRow[]> {
  try {
    const sb = await createPersistClient();
    const q = query.trim();
    let req = sb
      .from('profiles')
      .select('id, email, full_name, role, entity_id, active')
      .eq('active', true)
      .in('role', [...MANAGER_ELIGIBLE_ROLES])
      .order('full_name', { ascending: true })
      .limit(limit);

    if (q) {
      req = req.or(`email.ilike.%${q}%,full_name.ilike.%${q}%`);
    }

    const { data, error } = await req;
    if (error) {
      console.error('searchManagerCandidates', error.message);
      return [];
    }
    return (data ?? []).map((p) => {
      const role = String(p.role ?? 'associate') as AppRole;
      return {
        id: String(p.id),
        email: String(p.email ?? ''),
        full_name: (p.full_name as string) ?? null,
        role,
        role_label: APP_ROLE_LABELS[role] ?? role,
        entity_id: (p.entity_id as string) ?? null,
        company_name: entityDisplayName(p.entity_id as string | null),
        active: p.active !== false,
      };
    });
  } catch {
    return [];
  }
}

export async function getActiveManagerProfile(
  profileId: string,
): Promise<PeoplePickerRow | null> {
  const id = profileId.trim();
  if (!id) return null;
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('profiles')
      .select('id, email, full_name, role, entity_id, active')
      .eq('id', id)
      .maybeSingle();
    if (error || !data || data.active === false) return null;
    const role = String(data.role ?? 'associate') as AppRole;
    if (!(MANAGER_ELIGIBLE_ROLES as readonly string[]).includes(role)) {
      return null;
    }
    return {
      id: String(data.id),
      email: String(data.email ?? ''),
      full_name: (data.full_name as string) ?? null,
      role,
      role_label: APP_ROLE_LABELS[role] ?? role,
      entity_id: (data.entity_id as string) ?? null,
      company_name: entityDisplayName(data.entity_id as string | null),
      active: true,
    };
  } catch {
    return null;
  }
}
