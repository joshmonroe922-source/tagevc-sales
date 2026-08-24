import { requireSupabase } from './supabase';
import { TEXT_SEARCH_OPTS, searchLimit, toWebsearchQuery } from './textSearch';
import type { LeadActivity, SalesContact, SalesLead } from './types';

export type CreateContactInput = {
  full_name: string;
  account_id?: string | null;
  title?: string;
  company?: string;
  primary_email?: string;
  primary_phone?: string;
  emails?: string[];
  phones?: string[];
  notes?: string;
  created_by?: string | null;
};

export type UpdateContactInput = Partial<
  Omit<CreateContactInput, 'created_by'>
> & {
  archived_at?: string | null;
};

function normalizeEmail(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizePhone(value: string | undefined | null): string {
  return (value ?? '').trim();
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function buildEmailList(primary: string, extra: string[] | undefined): string[] {
  return uniqueNonEmpty([primary, ...(extra ?? [])].map((e) => e.toLowerCase()));
}

function buildPhoneList(primary: string, extra: string[] | undefined): string[] {
  return uniqueNonEmpty([primary, ...(extra ?? [])]);
}

const CONTACT_SELECT =
  '*, sales_accounts(id, name, account_type, website)';

export async function listContacts(opts?: {
  q?: string;
  accountId?: string | null;
  includeArchived?: boolean;
  limit?: number;
}): Promise<SalesContact[]> {
  const fts = toWebsearchQuery(opts?.q ?? '');
  let query = requireSupabase()
    .from('sales_contacts')
    .select(CONTACT_SELECT)
    .order('full_name', { ascending: true })
    .limit(searchLimit(opts?.limit, Boolean(fts)));

  if (!opts?.includeArchived) {
    query = query.is('archived_at', null);
  }
  if (opts?.accountId) {
    query = query.eq('account_id', opts.accountId);
  }

  if (fts) {
    query = query.textSearch('search_vector', fts, TEXT_SEARCH_OPTS);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as SalesContact[];
}

export async function getContact(id: string): Promise<SalesContact | null> {
  const { data, error } = await requireSupabase()
    .from('sales_contacts')
    .select(CONTACT_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as SalesContact | null;
}

export async function createContact(
  input: CreateContactInput,
): Promise<SalesContact> {
  const primaryEmail = normalizeEmail(input.primary_email);
  const primaryPhone = normalizePhone(input.primary_phone);
  let company = (input.company ?? '').trim();
  if (!company && input.account_id) {
    const { data: account } = await requireSupabase()
      .from('sales_accounts')
      .select('name')
      .eq('id', input.account_id)
      .maybeSingle();
    company = account?.name ?? '';
  }

  const { data, error } = await requireSupabase()
    .from('sales_contacts')
    .insert({
      account_id: input.account_id ?? null,
      full_name: input.full_name.trim(),
      title: (input.title ?? '').trim(),
      company,
      primary_email: primaryEmail,
      primary_phone: primaryPhone,
      emails: buildEmailList(primaryEmail, input.emails),
      phones: buildPhoneList(primaryPhone, input.phones),
      notes: input.notes ?? '',
      created_by: input.created_by ?? null,
    })
    .select(CONTACT_SELECT)
    .single();
  if (error) throw error;
  return data as SalesContact;
}

export async function updateContact(
  id: string,
  patch: UpdateContactInput,
): Promise<SalesContact> {
  const body: Record<string, unknown> = {};
  if (patch.full_name !== undefined) body.full_name = patch.full_name.trim();
  if (patch.title !== undefined) body.title = patch.title.trim();
  if (patch.company !== undefined) body.company = patch.company.trim();
  if (patch.notes !== undefined) body.notes = patch.notes;
  if (patch.archived_at !== undefined) body.archived_at = patch.archived_at;
  if (patch.account_id !== undefined) body.account_id = patch.account_id;

  if (patch.primary_email !== undefined || patch.emails !== undefined) {
    const primaryEmail = normalizeEmail(
      patch.primary_email ??
        (
          await requireSupabase()
            .from('sales_contacts')
            .select('primary_email')
            .eq('id', id)
            .single()
        ).data?.primary_email,
    );
    body.primary_email = primaryEmail;
    body.emails = buildEmailList(primaryEmail, patch.emails);
  }

  if (patch.primary_phone !== undefined || patch.phones !== undefined) {
    const primaryPhone = normalizePhone(
      patch.primary_phone ??
        (
          await requireSupabase()
            .from('sales_contacts')
            .select('primary_phone')
            .eq('id', id)
            .single()
        ).data?.primary_phone,
    );
    body.primary_phone = primaryPhone;
    body.phones = buildPhoneList(primaryPhone, patch.phones);
  }

  const { data, error } = await requireSupabase()
    .from('sales_contacts')
    .update(body)
    .eq('id', id)
    .select(CONTACT_SELECT)
    .single();
  if (error) throw error;

  // Keep denormalized lead identity in sync; UI prefers Contact as source of truth.
  const leadPatch: Record<string, unknown> = {};
  if (patch.full_name !== undefined) leadPatch.name = body.full_name;
  if (patch.primary_email !== undefined) leadPatch.email = body.primary_email;
  if (patch.primary_phone !== undefined) leadPatch.phone = body.primary_phone;
  if (Object.keys(leadPatch).length > 0) {
    await requireSupabase().from('sales_leads').update(leadPatch).eq('contact_id', id);
  }

  return data as SalesContact;
}

/** Display helpers — Contact wins when linked. */
export function leadContactName(lead: SalesLead): string {
  return lead.sales_contacts?.full_name?.trim() || lead.name?.trim() || '';
}

export function leadContactPhone(lead: SalesLead): string {
  return lead.sales_contacts?.primary_phone?.trim() || lead.phone?.trim() || '';
}

export function leadContactEmail(lead: SalesLead): string {
  return lead.sales_contacts?.primary_email?.trim() || lead.email?.trim() || '';
}

/**
 * Write name / phone / email from a deal surface onto the linked Contact
 * (create + attach Account when missing), then mirror onto the lead row.
 */
export async function writeLeadContactIdentity(
  lead: SalesLead,
  fields: { name?: string; email?: string; phone?: string },
  opts?: { createdBy?: string | null },
): Promise<SalesLead> {
  const { updateLeadViaEdge } = await import('./api');

  const nextName =
    fields.name !== undefined
      ? fields.name.trim()
      : leadContactName(lead);
  const nextEmail =
    fields.email !== undefined
      ? fields.email.trim().toLowerCase()
      : leadContactEmail(lead).toLowerCase();
  const nextPhone =
    fields.phone !== undefined
      ? fields.phone.trim()
      : leadContactPhone(lead);

  let contactId = lead.contact_id;

  if (contactId) {
    const patch: UpdateContactInput = {};
    if (fields.name !== undefined) patch.full_name = nextName || 'Unknown';
    if (fields.email !== undefined) patch.primary_email = nextEmail;
    if (fields.phone !== undefined) patch.primary_phone = nextPhone;
    if (lead.account_id && lead.sales_contacts?.account_id !== lead.account_id) {
      patch.account_id = lead.account_id;
    }
    if (Object.keys(patch).length > 0) {
      await updateContact(contactId, patch);
    }
  } else {
    const created = await createContact({
      full_name: nextName || nextEmail || 'Unknown',
      primary_email: nextEmail,
      primary_phone: nextPhone,
      account_id: lead.account_id,
      company: lead.sales_accounts?.name || lead.company || '',
      created_by: opts?.createdBy ?? null,
    });
    contactId = created.id;
  }

  return updateLeadViaEdge(lead.id, {
    name: nextName || nextEmail || 'Unknown',
    email: nextEmail,
    phone: nextPhone,
    contact_id: contactId,
  });
}

/** Find by email (primary or emails[]) or create a new contact. */
export async function findOrCreateContact(input: {
  full_name: string;
  account_id?: string | null;
  primary_email?: string;
  primary_phone?: string;
  company?: string;
  title?: string;
  notes?: string;
  created_by?: string | null;
}): Promise<SalesContact> {
  const email = normalizeEmail(input.primary_email);
  if (email) {
    const { data: byPrimary } = await requireSupabase()
      .from('sales_contacts')
      .select(CONTACT_SELECT)
      .ilike('primary_email', email)
      .is('archived_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (byPrimary) {
      const contact = byPrimary as SalesContact;
      if (input.account_id && !contact.account_id) {
        return updateContact(contact.id, { account_id: input.account_id });
      }
      return contact;
    }

    const { data: byEmails } = await requireSupabase()
      .from('sales_contacts')
      .select(CONTACT_SELECT)
      .contains('emails', [email])
      .is('archived_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (byEmails) {
      const contact = byEmails as SalesContact;
      if (input.account_id && !contact.account_id) {
        return updateContact(contact.id, { account_id: input.account_id });
      }
      return contact;
    }
  }

  return createContact(input);
}

export async function listLeadsForContact(contactId: string): Promise<SalesLead[]> {
  const { data, error } = await requireSupabase()
    .from('sales_leads')
    .select('*')
    .eq('contact_id', contactId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SalesLead[];
}

export async function listContactActivities(
  contactId: string,
  limit = 100,
): Promise<LeadActivity[]> {
  const { data, error } = await requireSupabase()
    .from('sales_lead_activities')
    .select('*')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as LeadActivity[];
}

export async function addContactNote(
  contactId: string,
  summary: string,
  createdBy: string,
  leadId?: string | null,
): Promise<void> {
  const client = requireSupabase();
  await client.from('sales_lead_activities').insert({
    contact_id: contactId,
    lead_id: leadId ?? null,
    activity_type: 'note',
    summary,
    created_by: createdBy,
  });
  const { data: contact } = await client
    .from('sales_contacts')
    .select('notes')
    .eq('id', contactId)
    .single();
  const existing = contact?.notes?.trim() ? `${contact.notes.trim()}\n\n` : '';
  await client
    .from('sales_contacts')
    .update({ notes: `${existing}${summary}` })
    .eq('id', contactId);
}

/** Placeholder + Phase 1 logger for RingCentral SMS / call (Embeddable events). */
export async function logContactComm(input: {
  contactId: string;
  leadId?: string | null;
  activityType: 'sms_sent' | 'sms_received' | 'call_logged' | 'call_missed';
  summary: string;
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
}): Promise<void> {
  await requireSupabase().from('sales_lead_activities').insert({
    contact_id: input.contactId,
    lead_id: input.leadId ?? null,
    activity_type: input.activityType,
    summary: input.summary,
    metadata: input.metadata ?? {},
    created_by: input.createdBy ?? null,
  });
}
