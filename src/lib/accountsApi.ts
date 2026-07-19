import { requireSupabase } from './supabase';
import type { AccountType, SalesAccount, SalesContact, SalesLead } from './types';

export type CreateAccountInput = {
  name: string;
  website?: string;
  account_type?: AccountType | string;
  notes?: string;
  created_by?: string | null;
};

export type UpdateAccountInput = Partial<Omit<CreateAccountInput, 'created_by'>> & {
  archived_at?: string | null;
};

export async function listAccounts(opts?: {
  q?: string;
  includeArchived?: boolean;
  limit?: number;
}): Promise<SalesAccount[]> {
  let query = requireSupabase()
    .from('sales_accounts')
    .select('*')
    .order('name', { ascending: true })
    .limit(opts?.limit ?? 200);

  if (!opts?.includeArchived) {
    query = query.is('archived_at', null);
  }

  const q = opts?.q?.trim();
  if (q) {
    const pattern = `%${q}%`;
    query = query.or(`name.ilike.${pattern},website.ilike.${pattern}`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as SalesAccount[];
}

export async function getAccount(id: string): Promise<SalesAccount | null> {
  const { data, error } = await requireSupabase()
    .from('sales_accounts')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as SalesAccount | null;
}

export async function createAccount(
  input: CreateAccountInput,
): Promise<SalesAccount> {
  const { data, error } = await requireSupabase()
    .from('sales_accounts')
    .insert({
      name: input.name.trim(),
      website: (input.website ?? '').trim(),
      account_type: input.account_type ?? 'prospect',
      notes: input.notes ?? '',
      created_by: input.created_by ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as SalesAccount;
}

export async function updateAccount(
  id: string,
  patch: UpdateAccountInput,
): Promise<SalesAccount> {
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) body.name = patch.name.trim();
  if (patch.website !== undefined) body.website = patch.website.trim();
  if (patch.account_type !== undefined) body.account_type = patch.account_type;
  if (patch.notes !== undefined) body.notes = patch.notes;
  if (patch.archived_at !== undefined) body.archived_at = patch.archived_at;

  const { data, error } = await requireSupabase()
    .from('sales_accounts')
    .update(body)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as SalesAccount;
}

/** Reuse account by case-insensitive name, or create. */
export async function findOrCreateAccount(input: {
  name: string;
  website?: string;
  account_type?: AccountType | string;
  notes?: string;
  created_by?: string | null;
}): Promise<SalesAccount> {
  const name = input.name.trim();
  if (!name) throw new Error('Account name is required');

  const { data: existing } = await requireSupabase()
    .from('sales_accounts')
    .select('*')
    .ilike('name', name)
    .is('archived_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing) return existing as SalesAccount;
  return createAccount(input);
}

export async function listContactsForAccount(
  accountId: string,
): Promise<SalesContact[]> {
  const { data, error } = await requireSupabase()
    .from('sales_contacts')
    .select('*, sales_accounts(id, name, account_type, website)')
    .eq('account_id', accountId)
    .is('archived_at', null)
    .order('full_name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as SalesContact[];
}

export async function listLeadsForAccount(accountId: string): Promise<SalesLead[]> {
  const { data, error } = await requireSupabase()
    .from('sales_leads')
    .select('*')
    .eq('account_id', accountId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SalesLead[];
}
