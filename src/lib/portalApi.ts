import { supabase } from './supabase';
import type { PortalSlug, SalesPortal, SalesUser } from './types';
import { mergePortalRows } from './portals';

type PortalRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  sort_order: number;
  active: boolean;
};

type AssignmentRow = {
  portal_id: string;
  sales_portals: PortalRow | PortalRow[] | null;
};

function normalizePortal(row: PortalRow): SalesPortal {
  return {
    id: row.id,
    slug: row.slug as PortalSlug,
    name: row.name,
    description: row.description,
    icon: row.icon,
    sort_order: row.sort_order,
    active: row.active,
  };
}

/** Portals assigned to the current user (RLS-filtered). */
export async function fetchAssignedPortals(salesUserId: string): Promise<SalesPortal[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('sales_user_portals')
    .select(
      'portal_id, sales_portals ( id, slug, name, description, icon, sort_order, active )',
    )
    .eq('sales_user_id', salesUserId);

  if (error) {
    console.error('portal assignments lookup failed:', error);
    return [];
  }

  const portals: SalesPortal[] = [];
  for (const row of (data ?? []) as AssignmentRow[]) {
    const raw = row.sales_portals;
    const portal = Array.isArray(raw) ? raw[0] : raw;
    if (portal && portal.active) portals.push(normalizePortal(portal));
  }

  return mergePortalRows(portals);
}

/** All active portals (admin assignment UI). */
export async function fetchAllPortals(): Promise<SalesPortal[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('sales_portals')
    .select('id, slug, name, description, icon, sort_order, active')
    .eq('active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('sales_portals list failed:', error);
    throw new Error(error.message);
  }

  return mergePortalRows((data ?? []).map((row) => normalizePortal(row as PortalRow)));
}

export async function fetchSalesUsersForAdmin(): Promise<
  Pick<SalesUser, 'id' | 'email' | 'full_name' | 'role' | 'active' | 'is_house_account'>[]
> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('sales_users')
    .select('id, email, full_name, role, active, is_house_account')
    .eq('active', true)
    .order('email');

  if (error) {
    console.error('sales_users list failed:', error);
    throw new Error(error.message);
  }

  return (data ?? []) as Pick<
    SalesUser,
    'id' | 'email' | 'full_name' | 'role' | 'active' | 'is_house_account'
  >[];
}

export async function fetchAssignmentsForUser(salesUserId: string): Promise<string[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('sales_user_portals')
    .select('portal_id')
    .eq('sales_user_id', salesUserId);

  if (error) {
    console.error('assignments for user failed:', error);
    throw new Error(error.message);
  }

  return (data ?? []).map((r) => r.portal_id as string);
}

export async function setUserPortalAssignment(
  salesUserId: string,
  portalId: string,
  assigned: boolean,
  assignedBy: string | null,
): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured');

  if (assigned) {
    const { error } = await supabase.from('sales_user_portals').upsert(
      {
        sales_user_id: salesUserId,
        portal_id: portalId,
        assigned_by: assignedBy,
      },
      { onConflict: 'sales_user_id,portal_id' },
    );
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase
    .from('sales_user_portals')
    .delete()
    .eq('sales_user_id', salesUserId)
    .eq('portal_id', portalId);

  if (error) throw new Error(error.message);
}
