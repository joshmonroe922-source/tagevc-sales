/**
 * C11 — product rows FK'd to shared graph (Recruit / NDA / Signent).
 * Instant NDA App Store portal left alone; OS graph tables only.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { resolveOrgIdBySlug } from '@/lib/spine/db/repos';
import { getActiveOrgSlug } from '@/lib/spine/auth/active-org';

/** Workers must never call this — hiring_manager is user-owned (T13). */
export async function createRecruitJobReq(input: {
  accountId: string;
  title: string;
  hiringManagerContactId?: string | null;
  orgSlug?: string;
  createdBy?: string | null;
  notes?: string | null;
}): Promise<
  | { ok: true; id: string }
  | { ok: false; error: string }
> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: 'title required' };
  const orgId = await resolveOrgIdBySlug(
    input.orgSlug || (await getActiveOrgSlug()),
  );
  if (!orgId) return { ok: false, error: 'org missing' };

  const sb = await createPersistClient({ mode: 'service' });
  const { data, error } = await sb
    .from('recruit_job_reqs')
    .insert({
      org_id: orgId,
      account_id: input.accountId,
      title,
      hiring_manager_contact_id: input.hiringManagerContactId || null,
      hiring_manager_locked: true,
      created_by: input.createdBy || null,
      notes: input.notes || null,
      status: 'open',
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message || 'insert failed' };
  return { ok: true, id: data.id };
}

export async function createNdaEnvelope(input: {
  accountId: string;
  signerContactIds?: string[];
  orgSlug?: string;
  createdBy?: string | null;
  templateId?: string | null;
}): Promise<
  | { ok: true; id: string }
  | { ok: false; error: string }
> {
  const orgId = await resolveOrgIdBySlug(
    input.orgSlug || (await getActiveOrgSlug()),
  );
  if (!orgId) return { ok: false, error: 'org missing' };

  const sb = await createPersistClient({ mode: 'service' });
  const { data, error } = await sb
    .from('nda_envelopes')
    .insert({
      org_id: orgId,
      account_id: input.accountId,
      status: 'draft',
      template_id: input.templateId || null,
      created_by: input.createdBy || null,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message || 'insert failed' };

  for (const contactId of input.signerContactIds ?? []) {
    await sb.from('nda_signers').upsert({
      envelope_id: data.id,
      contact_id: contactId,
      role: 'signer',
    });
  }
  return { ok: true, id: data.id };
}

export async function createSignentEngagement(input: {
  accountId: string;
  primaryContactId?: string | null;
  clientOrgId?: string | null;
  orgSlug?: string;
  notes?: string | null;
}): Promise<
  | { ok: true; id: string }
  | { ok: false; error: string }
> {
  const orgId = await resolveOrgIdBySlug(
    input.orgSlug || (await getActiveOrgSlug()),
  );
  if (!orgId) return { ok: false, error: 'org missing' };

  const sb = await createPersistClient({ mode: 'service' });
  const { data, error } = await sb
    .from('spine_signent_engagements')
    .insert({
      org_id: orgId,
      account_id: input.accountId,
      primary_contact_id: input.primaryContactId || null,
      client_org_id: input.clientOrgId || null,
      status: 'prospect',
      notes: input.notes || null,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message || 'insert failed' };
  return { ok: true, id: data.id };
}

export async function listAccountProductLinks(accountId: string): Promise<{
  recruitReqs: Array<{ id: string; title: string; status: string }>;
  ndaEnvelopes: Array<{ id: string; status: string }>;
  signentEngagements: Array<{ id: string; status: string }>;
}> {
  const empty = {
    recruitReqs: [] as Array<{ id: string; title: string; status: string }>,
    ndaEnvelopes: [] as Array<{ id: string; status: string }>,
    signentEngagements: [] as Array<{ id: string; status: string }>,
  };
  try {
    const sb = await createPersistClient({ mode: 'service' });
    const [reqs, ndas, signent] = await Promise.all([
      sb
        .from('recruit_job_reqs')
        .select('id, title, status')
        .eq('account_id', accountId)
        .limit(20),
      sb
        .from('nda_envelopes')
        .select('id, status')
        .eq('account_id', accountId)
        .limit(20),
      sb
        .from('spine_signent_engagements')
        .select('id, status')
        .eq('account_id', accountId)
        .limit(20),
    ]);
    return {
      recruitReqs: (reqs.data ?? []).map((r) => ({
        id: String(r.id),
        title: String(r.title),
        status: String(r.status),
      })),
      ndaEnvelopes: (ndas.data ?? []).map((r) => ({
        id: String(r.id),
        status: String(r.status),
      })),
      signentEngagements: (signent.data ?? []).map((r) => ({
        id: String(r.id),
        status: String(r.status),
      })),
    };
  } catch {
    return empty;
  }
}

/** Static guard surface for T13 — workers import bootstrap, never this. */
export const HIRING_MANAGER_USER_OWNED = true;
