/**
 * C11 product FK helpers — Recruit / NDA / Signent on shared graph.
 * Instant NDA App Store left alone; this is OS graph linkage only.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { resolveOrgIdBySlug } from '@/lib/spine/db/repos';

export async function createRecruitJobReq(input: {
  accountId: string;
  title: string;
  orgSlug?: string;
  hiringManagerContactId?: string | null;
  notes?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: 'title required' };
  const orgId = await resolveOrgIdBySlug(input.orgSlug || 'recruit619');
  if (!orgId) return { ok: false, error: 'org missing' };
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('recruit_job_reqs')
    .insert({
      org_id: orgId,
      account_id: input.accountId,
      title,
      hiring_manager_contact_id: input.hiringManagerContactId || null,
      hiring_manager_locked: true,
      notes: input.notes || null,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message || 'insert failed' };
  return { ok: true, id: data.id };
}

/** Workers must never call this — human API only (T13). */
export async function setRecruitHiringManager(input: {
  jobReqId: string;
  hiringManagerContactId: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = await createPersistClient();
  const { error } = await sb
    .from('recruit_job_reqs')
    .update({
      hiring_manager_contact_id: input.hiringManagerContactId,
      hiring_manager_locked: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.jobReqId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function createNdaEnvelope(input: {
  accountId: string;
  orgSlug?: string;
  templateId?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const orgId = await resolveOrgIdBySlug(input.orgSlug || 'instant_nda');
  if (!orgId) return { ok: false, error: 'org missing' };
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('nda_envelopes')
    .insert({
      org_id: orgId,
      account_id: input.accountId,
      status: 'draft',
      template_id: input.templateId || null,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message || 'insert failed' };
  return { ok: true, id: data.id };
}

export async function createSpineSignentEngagement(input: {
  accountId: string;
  orgSlug?: string;
  primaryContactId?: string | null;
  notes?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const orgId = await resolveOrgIdBySlug(input.orgSlug || 'signent');
  if (!orgId) return { ok: false, error: 'org missing' };
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('spine_signent_engagements')
    .insert({
      org_id: orgId,
      account_id: input.accountId,
      primary_contact_id: input.primaryContactId || null,
      status: 'prospect',
      notes: input.notes || null,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message || 'insert failed' };
  return { ok: true, id: data.id };
}

export async function listAccountProducts(accountId: string): Promise<{
  recruitReqs: Array<{ id: string; title: string; status: string }>;
  ndaEnvelopes: Array<{ id: string; status: string }>;
  signentEngagements: Array<{ id: string; status: string }>;
}> {
  const sb = await createPersistClient();
  const [reqs, ndas, se] = await Promise.all([
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
      id: r.id,
      title: r.title,
      status: r.status,
    })),
    ndaEnvelopes: (ndas.data ?? []).map((n) => ({
      id: n.id,
      status: n.status,
    })),
    signentEngagements: (se.data ?? []).map((s) => ({
      id: s.id,
      status: s.status,
    })),
  };
}
