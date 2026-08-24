/**
 * Graph CRUD + search + org-edge mutations (C3 / C7–C9 API layer).
 */

import {
  createPersistClient,
} from '@/lib/supabase/persist-client';
import { resolveOrgIdBySlug } from '@/lib/spine/db/repos';
import { accountBootstrapKey } from '@/lib/spine/enrichment/jobs';
import { getActiveOrgSlug } from '@/lib/spine/auth/active-org-server';

function domainFromInput(domain?: string | null, website?: string | null): string | null {
  const raw = (domain || website || '').trim().toLowerCase().replace(/^www\./, '');
  if (!raw) return null;
  try {
    const host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname
      .replace(/^www\./, '')
      .toLowerCase();
    return host || null;
  } catch {
    return raw.includes('.') ? raw : null;
  }
}

export async function createAccount(input: {
  name: string;
  domain?: string | null;
  website?: string | null;
  orgSlug?: string;
  expand?: boolean;
}): Promise<
  | { ok: true; accountId: string; jobId: string | null }
  | { ok: false; error: string }
> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'name required' };
  const orgId = await resolveOrgIdBySlug(
    input.orgSlug || (await getActiveOrgSlug()),
  );
  if (!orgId) return { ok: false, error: 'org missing — apply phase94' };

  const domain = domainFromInput(input.domain, input.website);
  // Explicit service for graph writes until Entra JWT org_ids hook is live.
  // Always stamps account_org_links for active org (app-level isolation).
  const sb = await createPersistClient({ mode: 'service' });

  if (domain) {
    const existing = await sb
      .from('accounts')
      .select('id')
      .eq('canonical_domain', domain)
      .maybeSingle();
    if (existing.data?.id) {
      await sb.from('account_org_links').upsert({
        account_id: existing.data.id,
        org_id: orgId,
        visibility: 'org',
        is_primary: true,
      });
      return { ok: true, accountId: existing.data.id, jobId: null };
    }
  }

  const { data: acc, error } = await sb
    .from('accounts')
    .insert({
      name,
      canonical_domain: domain,
      website: input.website || (domain ? `https://${domain}` : null),
      enrich_status: 'pending',
    })
    .select('id')
    .single();
  if (error || !acc) return { ok: false, error: error?.message || 'insert failed' };

  await sb.from('account_org_links').upsert({
    account_id: acc.id,
    org_id: orgId,
    visibility: 'org',
    is_primary: true,
  });

  // Trigger also enqueues; optional explicit refresh
  let jobId: string | null = null;
  if (input.expand !== false) {
    const key = accountBootstrapKey(acc.id, orgId);
    const { data: job } = await sb
      .from('enrichment_jobs')
      .upsert(
        {
          org_id: orgId,
          type: 'account.bootstrap',
          payload: { account_id: acc.id, org_id: orgId, expand: true },
          idempotency_key: key,
          account_id: acc.id,
          status: 'queued',
        },
        { onConflict: 'idempotency_key' },
      )
      .select('id')
      .maybeSingle();
    jobId = job?.id ?? null;
  }

  return { ok: true, accountId: acc.id, jobId };
}

export async function createContact(input: {
  fullName: string;
  email?: string | null;
  title?: string | null;
  accountId?: string | null;
  orgSlug?: string;
  linkedinUrl?: string | null;
}): Promise<
  | { ok: true; contactId: string }
  | { ok: false; error: string }
> {
  const fullName = input.fullName.trim();
  if (!fullName) return { ok: false, error: 'full_name required' };
  const orgId = await resolveOrgIdBySlug(
    input.orgSlug || (await getActiveOrgSlug()),
  );
  if (!orgId) return { ok: false, error: 'org missing' };

  const sb = await createPersistClient({ mode: 'service' });
  const email = (input.email || '').trim().toLowerCase() || null;

  // T09: email domain → ensure account when input.accountId omitted
  let accountId = input.accountId || null;
  if (!accountId && email && email.includes('@')) {
    const host = email.split('@')[1]?.toLowerCase() || null;
    const personal = new Set([
      'gmail.com',
      'yahoo.com',
      'hotmail.com',
      'outlook.com',
      'icloud.com',
      'aol.com',
    ]);
    if (host && !personal.has(host)) {
      const ensured = await createAccount({
        name: host.split('.')[0] || host,
        domain: host,
        orgSlug: input.orgSlug || (await getActiveOrgSlug()),
        expand: false,
      });
      if (ensured.ok) accountId = ensured.accountId;
    }
  }

  if (email) {
    const hit = await sb
      .from('contacts')
      .select('id')
      .ilike('primary_email', email)
      .maybeSingle();
    if (hit.data?.id) {
      await sb.from('contact_org_links').upsert({
        contact_id: hit.data.id,
        org_id: orgId,
        visibility: 'org',
        is_primary: true,
      });
      if (accountId) {
        await sb.from('employments').insert({
          contact_id: hit.data.id,
          account_id: accountId,
          title: input.title || null,
          is_current: true,
          source: 'manual',
        });
      }
      return { ok: true, contactId: hit.data.id };
    }
  }

  const parts = fullName.split(/\s+/);
  const { data: c, error } = await sb
    .from('contacts')
    .insert({
      full_name: fullName,
      first_name: parts[0] || null,
      last_name: parts.slice(1).join(' ') || null,
      primary_email: email,
      title: input.title || null,
      linkedin_url: input.linkedinUrl || null,
      enrich_status: 'pending',
    })
    .select('id')
    .single();
  if (error || !c) return { ok: false, error: error?.message || 'insert failed' };

  await sb.from('contact_org_links').upsert({
    contact_id: c.id,
    org_id: orgId,
    visibility: 'org',
    is_primary: true,
  });

  if (accountId) {
    await sb.from('employments').insert({
      contact_id: c.id,
      account_id: accountId,
      title: input.title || null,
      is_current: true,
      source: 'manual',
    });
  }

  const day = new Date().toISOString().slice(0, 10);
  await sb.from('enrichment_jobs').upsert(
    {
      org_id: orgId,
      type: 'contact.bootstrap',
      payload: {
        contact_id: c.id,
        account_id: accountId,
        org_id: orgId,
      },
      idempotency_key: `contact.bootstrap:${c.id}:${day}`,
      contact_id: c.id,
      account_id: accountId,
      status: 'queued',
    },
    { onConflict: 'idempotency_key' },
  );

  return { ok: true, contactId: c.id };
}

export async function patchContactAsUser(input: {
  contactId: string;
  fields: Record<string, string | null>;
  userProfileId?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = await createPersistClient({ mode: 'service' });
  const allowed = [
    'full_name',
    'first_name',
    'last_name',
    'primary_email',
    'title',
    'department',
    'location',
    'linkedin_url',
    'phone',
  ] as const;

  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input.fields)) {
    if (!(allowed as readonly string[]).includes(k)) continue;
    // user PATCH always writes + locks (user beats agent)
    if (k === 'phone') {
      updates.phones = v ? [{ type: 'mobile', value: v }] : [];
    } else {
      updates[k] = v;
    }
  }
  if (!Object.keys(updates).length) {
    return { ok: false, error: 'no valid fields' };
  }

  const { error } = await sb
    .from('contacts')
    .update(updates)
    .eq('id', input.contactId);
  if (error) return { ok: false, error: error.message };

  for (const [field, value] of Object.entries(input.fields)) {
    if (!(allowed as readonly string[]).includes(field) || field === 'phone') continue;
    await sb.from('field_provenance').upsert(
      {
        entity_type: 'contact',
        entity_id: input.contactId,
        field_name: field,
        value: value,
        source: 'user',
        confidence: 1,
        locked: true,
        locked_by: input.userProfileId || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'entity_type,entity_id,field_name' },
    );
    await sb.from('contact_field_history').insert({
      contact_id: input.contactId,
      field_name: field,
      new_value: value,
      source: 'user',
    });
  }

  return { ok: true };
}

export type SearchHit = {
  type: 'account' | 'contact' | 'job';
  id: string;
  label: string;
  sublabel: string | null;
  href: string;
};

const FTS_OPTS = { type: 'websearch' as const, config: 'english' };

function toWebsearchQuery(raw: string): string | null {
  const q = raw.trim().replace(/[%\\]/g, ' ').replace(/\s+/g, ' ').trim();
  return q.length >= 2 ? q : null;
}

export async function searchGraph(
  q: string,
  limit = 20,
): Promise<{ hits: SearchHit[]; error?: string }> {
  const query = toWebsearchQuery(q);
  if (!query) return { hits: [] };
  const rowLimit = Math.min(Math.max(limit, 1), 40);
  try {
    const sb = await createPersistClient({ mode: 'service' });
    const orgId = await resolveOrgIdBySlug(await getActiveOrgSlug());

    // Org-scoped via link tables (app-level isolation until JWT claims RLS).
    let accountIds: string[] | null = null;
    let contactIds: string[] | null = null;
    if (orgId) {
      const [aLinks, cLinks] = await Promise.all([
        sb
          .from('account_org_links')
          .select('account_id')
          .eq('org_id', orgId)
          .limit(500),
        sb
          .from('contact_org_links')
          .select('contact_id')
          .eq('org_id', orgId)
          .limit(500),
      ]);
      accountIds = (aLinks.data ?? []).map((r) => String(r.account_id));
      contactIds = (cLinks.data ?? []).map((r) => String(r.contact_id));
    }

    const accountQ = sb
      .from('accounts')
      .select('id, name, canonical_domain')
      .textSearch('search_vector', query, FTS_OPTS)
      .limit(rowLimit);
    const contactQ = sb
      .from('contacts')
      .select('id, full_name, primary_email, title')
      .textSearch('search_vector', query, FTS_OPTS)
      .limit(rowLimit);
    let jobQ = sb
      .from('recruit_job_reqs')
      .select('id, title, req_number, location, account_id')
      .textSearch('search_vector', query, FTS_OPTS)
      .limit(rowLimit);
    if (orgId) jobQ = jobQ.eq('org_id', orgId);

    const [accounts, contacts, jobs] = await Promise.all([
      accountIds && accountIds.length
        ? accountQ.in('id', accountIds)
        : accountIds
          ? Promise.resolve({ data: [] as Array<{
              id: string;
              name: string;
              canonical_domain: string | null;
            }> })
          : accountQ,
      contactIds && contactIds.length
        ? contactQ.in('id', contactIds)
        : contactIds
          ? Promise.resolve({ data: [] as Array<{
              id: string;
              full_name: string;
              primary_email: string | null;
              title: string | null;
            }> })
          : contactQ,
      jobQ,
    ]);

    const hits: SearchHit[] = [];
    for (const a of accounts.data ?? []) {
      hits.push({
        type: 'account',
        id: a.id,
        label: a.name,
        sublabel: a.canonical_domain,
        href: `/shared-services/crm/accounts/${a.id}`,
      });
    }
    for (const c of contacts.data ?? []) {
      hits.push({
        type: 'contact',
        id: c.id,
        label: c.full_name,
        sublabel: [c.title, c.primary_email].filter(Boolean).join(' · ') || null,
        href: `/shared-services/crm/contacts/${c.id}`,
      });
    }
    for (const j of jobs.data ?? []) {
      hits.push({
        type: 'job',
        id: j.id,
        label: j.title,
        sublabel: [j.req_number, j.location].filter(Boolean).join(' · ') || null,
        href: j.account_id
          ? `/shared-services/crm/accounts/${j.account_id}`
          : '/shared-services/crm',
      });
    }
    return { hits: hits.slice(0, rowLimit) };
  } catch (e) {
    return {
      hits: [],
      error: e instanceof Error ? e.message : 'search failed',
    };
  }
}

export async function listAccountOrgChart(accountId: string): Promise<{
  nodes: Array<{
    id: string;
    full_name: string;
    title: string | null;
  }>;
  edges: Array<{
    id: string;
    manager_contact_id: string;
    report_contact_id: string;
    status: string;
    confidence: number | null;
    rationale: string | null;
  }>;
  error?: string;
}> {
  try {
    const sb = await createPersistClient({ mode: 'service' });
    const { data: emps } = await sb
      .from('employments')
      .select('contact_id, title, contacts(id, full_name, title)')
      .eq('account_id', accountId)
      .eq('is_current', true);

    const nodes: Array<{
      id: string;
      full_name: string;
      title: string | null;
    }> = [];
    for (const e of emps ?? []) {
      const c = e.contacts as unknown as {
        id: string;
        full_name: string;
        title: string | null;
      } | null;
      if (!c) continue;
      nodes.push({
        id: c.id,
        full_name: c.full_name,
        title: e.title || c.title,
      });
    }

    const { data: edges } = await sb
      .from('org_edges')
      .select(
        'id, manager_contact_id, report_contact_id, status, confidence, rationale',
      )
      .eq('account_id', accountId)
      .in('status', ['suggested', 'confirmed']);

    return {
      nodes,
      edges: (edges ?? []).map((ed) => ({
        id: ed.id,
        manager_contact_id: ed.manager_contact_id,
        report_contact_id: ed.report_contact_id,
        status: ed.status,
        confidence: ed.confidence,
        rationale: ed.rationale,
      })),
    };
  } catch (e) {
    return {
      nodes: [],
      edges: [],
      error: e instanceof Error ? e.message : 'org chart failed',
    };
  }
}

export async function setOrgEdgeStatus(input: {
  edgeId: string;
  status: 'confirmed' | 'rejected';
  userProfileId?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = await createPersistClient({ mode: 'service' });
  const patch: Record<string, unknown> = {
    status: input.status,
    updated_at: new Date().toISOString(),
  };
  if (input.status === 'confirmed') {
    patch.confirmed_at = new Date().toISOString();
    patch.confirmed_by = input.userProfileId || null;
  }
  const { error } = await sb
    .from('org_edges')
    .update(patch)
    .eq('id', input.edgeId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Accept a suggested_update: write value onto entity + lock provenance (C8).
 * Reject only flips status.
 */
export async function decideSuggestedUpdate(input: {
  id: string;
  status: 'accepted' | 'rejected';
  userProfileId?: string | null;
}): Promise<{ ok: true; applied?: boolean } | { ok: false; error: string }> {
  const sb = await createPersistClient({ mode: 'service' });
  const { data: row, error } = await sb
    .from('suggested_updates')
    .select(
      'id, entity_type, entity_id, field_name, suggested_value, status, org_id',
    )
    .eq('id', input.id)
    .maybeSingle();
  if (error || !row) {
    return { ok: false, error: error?.message || 'suggestion not found' };
  }
  if (row.status !== 'pending') {
    return { ok: false, error: `already ${row.status}` };
  }

  if (input.status === 'rejected') {
    const { error: uErr } = await sb
      .from('suggested_updates')
      .update({
        status: 'rejected',
        resolved_at: new Date().toISOString(),
        resolved_by: input.userProfileId || null,
      })
      .eq('id', input.id);
    if (uErr) return { ok: false, error: uErr.message };
    return { ok: true, applied: false };
  }

  const field = String(row.field_name);
  const value = row.suggested_value != null ? String(row.suggested_value) : '';
  const entityType = String(row.entity_type);
  const entityId = String(row.entity_id);

  if (entityType === 'contact' && value) {
    const allowed = [
      'full_name',
      'primary_email',
      'title',
      'linkedin_url',
      'phone',
    ] as const;
    if ((allowed as readonly string[]).includes(field)) {
      const patch: Record<string, unknown> = {};
      if (field === 'phone') {
        patch.phones = value ? [{ type: 'mobile', value }] : [];
      } else {
        patch[field] = value;
      }
      const { error: cErr } = await sb
        .from('contacts')
        .update(patch)
        .eq('id', entityId);
      if (cErr) return { ok: false, error: cErr.message };
      await sb.from('field_provenance').upsert(
        {
          entity_type: 'contact',
          entity_id: entityId,
          field_name: field === 'phone' ? 'phones' : field,
          value,
          source: 'user',
          confidence: 1,
          locked: true,
          locked_by: input.userProfileId || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'entity_type,entity_id,field_name' },
      );
      await sb.from('contact_field_history').insert({
        contact_id: entityId,
        field_name: field,
        new_value: value,
        source: 'user',
      });
    }
  } else if (entityType === 'account' && value) {
    const allowed = [
      'name',
      'website',
      'description',
      'industry',
      'canonical_domain',
    ] as const;
    if ((allowed as readonly string[]).includes(field)) {
      const { error: aErr } = await sb
        .from('accounts')
        .update({ [field]: value })
        .eq('id', entityId);
      if (aErr) return { ok: false, error: aErr.message };
      await sb.from('field_provenance').upsert(
        {
          entity_type: 'account',
          entity_id: entityId,
          field_name: field,
          value,
          source: 'user',
          confidence: 1,
          locked: true,
          locked_by: input.userProfileId || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'entity_type,entity_id,field_name' },
      );
    }
  }

  const { error: uErr } = await sb
    .from('suggested_updates')
    .update({
      status: 'accepted',
      resolved_at: new Date().toISOString(),
      resolved_by: input.userProfileId || null,
    })
    .eq('id', input.id);
  if (uErr) return { ok: false, error: uErr.message };
  return { ok: true, applied: Boolean(value) };
}

export async function countPendingSuggestions(): Promise<number> {
  try {
    const sb = await createPersistClient({ mode: 'service' });
    const orgId = await resolveOrgIdBySlug(await getActiveOrgSlug());
    let q = sb
      .from('suggested_updates')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    if (orgId) q = q.eq('org_id', orgId);
    const { count } = await q;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export async function listRecentEnrichmentJobs(limit = 8): Promise<
  Array<{
    id: string;
    type: string;
    status: string;
    progress_pct: number | null;
    progress_message: string | null;
    account_id: string | null;
  }>
> {
  try {
    const sb = await createPersistClient({ mode: 'service' });
    const orgId = await resolveOrgIdBySlug(await getActiveOrgSlug());
    let q = sb
      .from('enrichment_jobs')
      .select(
        'id, type, status, progress_pct, progress_message, account_id, created_at',
      )
      .in('status', ['queued', 'running', 'succeeded', 'failed', 'budget_blocked'])
      .order('created_at', { ascending: false })
      .limit(limit);
    if (orgId) q = q.eq('org_id', orgId);
    const { data } = await q;
    return (data ?? []).map((j) => ({
      id: String(j.id),
      type: String(j.type),
      status: String(j.status),
      progress_pct: j.progress_pct == null ? null : Number(j.progress_pct),
      progress_message: j.progress_message
        ? String(j.progress_message)
        : null,
      account_id: j.account_id ? String(j.account_id) : null,
    }));
  } catch {
    return [];
  }
}

/** Drag-to-set-manager on org chart (user-confirmed edge). */
export async function upsertOrgEdgeFromDrag(input: {
  accountId: string;
  managerContactId: string;
  reportContactId: string;
  userProfileId?: string | null;
}): Promise<{ ok: true; edgeId: string } | { ok: false; error: string }> {
  if (input.managerContactId === input.reportContactId) {
    return { ok: false, error: 'self_edge' };
  }
  const sb = await createPersistClient({ mode: 'service' });
  const { data: existing } = await sb
    .from('org_edges')
    .select('id, status')
    .eq('account_id', input.accountId)
    .eq('manager_contact_id', input.managerContactId)
    .eq('report_contact_id', input.reportContactId)
    .maybeSingle();
  if (existing?.status === 'rejected') {
    return { ok: false, error: 'pair_rejected' };
  }
  if (existing?.id) {
    const { error } = await sb
      .from('org_edges')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        confirmed_by: input.userProfileId || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, edgeId: existing.id };
  }
  const { data, error } = await sb
    .from('org_edges')
    .insert({
      account_id: input.accountId,
      manager_contact_id: input.managerContactId,
      report_contact_id: input.reportContactId,
      relation: 'reports_to',
      status: 'confirmed',
      confidence: 1,
      rationale: 'User drag on org chart',
      confirmed_at: new Date().toISOString(),
      confirmed_by: input.userProfileId || null,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message || 'insert failed' };
  return { ok: true, edgeId: data.id };
}

/** Rule-based hierarchy suggestions (agent.hierarchy lite — no LLM). */
export async function suggestHierarchyForAccount(
  accountId: string,
): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  const chart = await listAccountOrgChart(accountId);
  if (chart.error) return { ok: false, error: chart.error };
  if (chart.nodes.length < 2) return { ok: true, created: 0 };

  const rank = (title: string | null) => {
    const t = (title || '').toLowerCase();
    if (/\b(ceo|founder|president|partner)\b/.test(t)) return 100;
    if (/\b(coo|cfo|cto|chro|chief)\b/.test(t)) return 90;
    if (/\bvp\b|vice president/.test(t)) return 80;
    if (/\bdirector\b/.test(t)) return 60;
    if (/\bmanager\b|head of/.test(t)) return 40;
    return 20;
  };

  const sorted = [...chart.nodes].sort(
    (a, b) => rank(b.title) - rank(a.title),
  );
  const top = sorted[0];
  const sb = await createPersistClient({ mode: 'service' });
  // Never overwrite confirmed; never re-suggest rejected pairs (T07/T08).
  const { data: prior } = await sb
    .from('org_edges')
    .select('manager_contact_id, report_contact_id, status')
    .eq('account_id', accountId)
    .in('status', ['suggested', 'confirmed', 'rejected']);
  const blocked = new Set(
    (prior ?? []).map((e) => `${e.manager_contact_id}:${e.report_contact_id}`),
  );
  let created = 0;
  for (const n of sorted.slice(1)) {
    if (rank(n.title) >= rank(top.title)) continue;
    const key = `${top.id}:${n.id}`;
    if (blocked.has(key)) continue;
    const { error } = await sb.from('org_edges').insert({
      account_id: accountId,
      manager_contact_id: top.id,
      report_contact_id: n.id,
      relation: 'reports_to',
      status: 'suggested',
      confidence: 0.55,
      rationale: `Rule: ${n.title || 'IC'} reports to highest band (${top.title})`,
      suggested_by: 'agent.hierarchy.rules',
    });
    if (!error) created += 1;
  }
  return { ok: true, created };
}

/** Roll employment on job change (T17). */
export async function rollEmploymentOnJobChange(input: {
  contactId: string;
  newAccountId: string;
  newTitle?: string | null;
  source?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = await createPersistClient({ mode: 'service' });
  const today = new Date().toISOString().slice(0, 10);
  const { error: endErr } = await sb
    .from('employments')
    .update({ is_current: false, ended_on: today })
    .eq('contact_id', input.contactId)
    .eq('is_current', true);
  if (endErr) return { ok: false, error: endErr.message };
  const { error } = await sb.from('employments').insert({
    contact_id: input.contactId,
    account_id: input.newAccountId,
    title: input.newTitle || null,
    is_current: true,
    started_on: today,
    source: input.source || 'job_change',
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
