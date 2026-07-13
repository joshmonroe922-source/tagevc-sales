import type { Session } from '@supabase/supabase-js';
import { fetchAllPortals, fetchAssignedPortals } from './portalApi';
import { supabase } from './supabase';
import type { SalesUser } from './types';

export async function fetchSalesUser(session: Session): Promise<SalesUser | null> {
  if (!supabase || !session.user.email) return null;

  const email = session.user.email.trim().toLowerCase();
  const { data, error } = await supabase
    .from('sales_users')
    .select('id, email, work_email, full_name, role, active, manager_id, is_house_account')
    .eq('email', email)
    .eq('active', true)
    .maybeSingle();

  if (error) {
    console.error('sales_users lookup failed:', error);
    return null;
  }

  if (!data) return null;

  const base = data as Omit<SalesUser, 'portals'>;
  // Admins (Josh) always see every portal — assignment rows are still seeded for consistency.
  const portals =
    base.role === 'admin'
      ? await fetchAllPortals().catch(async () => fetchAssignedPortals(base.id))
      : await fetchAssignedPortals(base.id);

  return { ...base, portals };
}

export async function signInWithPassword(email: string, password: string) {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signInWithMagicLink(email: string) {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase.auth.signInWithOtp({
    email: email.trim(),
    options: {
      emailRedirectTo: `${window.location.origin}/sales`,
    },
  });
}

export function passwordResetRedirectTo() {
  return `${window.location.origin}/sales/reset-password`;
}

export async function resetPasswordForEmail(email: string) {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: passwordResetRedirectTo(),
  });
}

export async function updatePassword(password: string) {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase.auth.updateUser({ password });
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}
