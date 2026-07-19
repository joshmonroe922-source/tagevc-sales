import { supabase } from './supabase';

export type MailSignature = {
  id: string;
  name: string;
  body_html: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

function requireRpc() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

function mapRow(row: Record<string, unknown>): MailSignature {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    body_html: String(row.body_html ?? ''),
    is_default: Boolean(row.is_default),
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

export async function listMyMailSignatures(): Promise<MailSignature[]> {
  const { data, error } = await requireRpc().rpc('list_my_mail_signatures');
  if (error) throw error;
  const rows = (data as Record<string, unknown>[] | null) ?? [];
  return rows.map(mapRow);
}

export async function createMyMailSignature(opts: {
  name: string;
  body_html: string;
  is_default?: boolean;
}): Promise<MailSignature> {
  const { data, error } = await requireRpc().rpc('upsert_my_mail_signature', {
    p_id: null,
    p_name: opts.name.trim(),
    p_body_html: opts.body_html,
    p_is_default: Boolean(opts.is_default),
  });
  if (error) throw error;
  return mapRow((data as Record<string, unknown>) ?? {});
}

export async function updateMyMailSignature(
  id: string,
  opts: { name?: string; body_html?: string; is_default?: boolean },
): Promise<MailSignature> {
  const { data, error } = await requireRpc().rpc('upsert_my_mail_signature', {
    p_id: id,
    p_name: opts.name ?? null,
    p_body_html: opts.body_html ?? null,
    p_is_default: opts.is_default ?? false,
  });
  if (error) throw error;
  return mapRow((data as Record<string, unknown>) ?? {});
}

export async function deleteMyMailSignature(id: string): Promise<void> {
  const { error } = await requireRpc().rpc('delete_my_mail_signature', { p_id: id });
  if (error) throw error;
}

export async function setMyDefaultMailSignature(id: string): Promise<MailSignature> {
  const { data, error } = await requireRpc().rpc('set_my_default_mail_signature', { p_id: id });
  if (error) throw error;
  return mapRow((data as Record<string, unknown>) ?? {});
}
