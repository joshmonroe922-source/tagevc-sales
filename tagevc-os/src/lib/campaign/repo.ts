/**
 * Campaign repository — CRUD helpers for ECC tables.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import type { CampaignRow, ListRow, TemplateRow } from '@/lib/campaign/types';

export async function listCampaigns(
  entityId: string,
  opts?: { status?: string; q?: string; attachable?: boolean; limit?: number },
): Promise<CampaignRow[]> {
  const sb = await createPersistClient({ mode: 'service' });
  let q = sb
    .from('ecc_campaigns')
    .select('*')
    .eq('entity_id', entityId)
    .order('updated_at', { ascending: false })
    .limit(opts?.limit ?? 50);
  if (opts?.status) q = q.eq('status', opts.status);
  if (opts?.attachable) {
    q = q.in('status', ['draft', 'approved', 'scheduled', 'paused']);
  }
  if (opts?.q) q = q.ilike('name', `%${opts.q}%`);
  const { data } = await q;
  return (data ?? []) as CampaignRow[];
}

export async function getCampaign(
  entityId: string,
  id: string,
): Promise<CampaignRow | null> {
  const sb = await createPersistClient({ mode: 'service' });
  const { data } = await sb
    .from('ecc_campaigns')
    .select('*')
    .eq('entity_id', entityId)
    .eq('id', id)
    .maybeSingle();
  return (data as CampaignRow) ?? null;
}

export async function createCampaign(input: {
  entityId: string;
  name: string;
  campaignType?: string;
  subject?: string;
  bodyHtml?: string;
  templateId?: string | null;
  audienceType?: 'list' | 'segment' | 'contacts' | null;
  audienceId?: string | null;
  deliveryPlane?: string;
  createdBy?: string | null;
  ownerId?: string | null;
}): Promise<CampaignRow | null> {
  const sb = await createPersistClient({ mode: 'service' });
  const { data } = await sb
    .from('ecc_campaigns')
    .insert({
      entity_id: input.entityId,
      name: input.name,
      campaign_type: input.campaignType ?? 'blast',
      subject: input.subject ?? '',
      body_html: input.bodyHtml ?? '',
      template_id: input.templateId ?? null,
      audience_type: input.audienceType ?? null,
      audience_id: input.audienceId ?? null,
      delivery_plane: input.deliveryPlane ?? 'graph',
      created_by: input.createdBy ?? null,
      owner_id: input.ownerId ?? input.createdBy ?? null,
      status: 'draft',
    })
    .select('*')
    .single();
  return (data as CampaignRow) ?? null;
}

export async function updateCampaign(
  entityId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<CampaignRow | null> {
  const sb = await createPersistClient({ mode: 'service' });
  const { data } = await sb
    .from('ecc_campaigns')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('entity_id', entityId)
    .eq('id', id)
    .select('*')
    .single();
  return (data as CampaignRow) ?? null;
}

export async function listTemplates(entityId: string): Promise<TemplateRow[]> {
  const sb = await createPersistClient({ mode: 'service' });
  const { data } = await sb
    .from('ecc_templates')
    .select('*')
    .eq('entity_id', entityId)
    .neq('status', 'archived')
    .order('updated_at', { ascending: false });
  return (data ?? []) as TemplateRow[];
}

export async function createTemplate(input: {
  entityId: string;
  name: string;
  subject?: string;
  html?: string;
  category?: string;
  createdBy?: string | null;
}): Promise<TemplateRow | null> {
  const sb = await createPersistClient({ mode: 'service' });
  const { data } = await sb
    .from('ecc_templates')
    .insert({
      entity_id: input.entityId,
      name: input.name,
      subject: input.subject ?? '',
      html: input.html ?? '',
      category: input.category ?? 'general',
      status: 'draft',
      created_by: input.createdBy ?? null,
    })
    .select('*')
    .single();
  return (data as TemplateRow) ?? null;
}

export async function listLists(entityId: string): Promise<ListRow[]> {
  const sb = await createPersistClient({ mode: 'service' });
  const { data } = await sb
    .from('ecc_lists')
    .select('*')
    .eq('entity_id', entityId)
    .order('updated_at', { ascending: false });
  return (data ?? []) as ListRow[];
}

export async function createList(input: {
  entityId: string;
  name: string;
  description?: string;
  createdBy?: string | null;
}): Promise<ListRow | null> {
  const sb = await createPersistClient({ mode: 'service' });
  const { data } = await sb
    .from('ecc_lists')
    .insert({
      entity_id: input.entityId,
      name: input.name,
      description: input.description ?? null,
      created_by: input.createdBy ?? null,
      list_type: 'static',
    })
    .select('*')
    .single();
  return (data as ListRow) ?? null;
}

export async function addListMembers(
  listId: string,
  contactIds: string[],
  source = 'manual',
): Promise<number> {
  if (!contactIds.length) return 0;
  const sb = await createPersistClient({ mode: 'service' });
  const rows = contactIds.map((contact_id) => ({
    list_id: listId,
    contact_id,
    source,
  }));
  const { data, error } = await sb
    .from('ecc_list_members')
    .upsert(rows, { onConflict: 'list_id,contact_id', ignoreDuplicates: true })
    .select('contact_id');
  if (error) return 0;
  const { count } = await sb
    .from('ecc_list_members')
    .select('*', { count: 'exact', head: true })
    .eq('list_id', listId);
  await sb
    .from('ecc_lists')
    .update({
      count_cached: count ?? 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', listId);
  return data?.length ?? 0;
}

export async function getCampaignRecipients(
  campaignId: string,
  opts?: { sort?: 'score' | 'sent_at'; filter?: string; limit?: number },
) {
  const sb = await createPersistClient({ mode: 'service' });
  let q = sb
    .from('ecc_campaign_recipients')
    .select('*')
    .eq('campaign_id', campaignId)
    .limit(opts?.limit ?? 100);
  if (opts?.sort === 'score') q = q.order('score', { ascending: false });
  else q = q.order('sent_at', { ascending: false });
  const { data } = await q;
  let rows = data ?? [];
  if (opts?.filter === 'clicked_no_reply') {
    rows = rows.filter((r) => Number(r.click_count) > 0 && !r.replied);
  } else if (opts?.filter === 'hot') {
    rows = rows.filter((r) => Number(r.score) >= 4);
  }
  return rows;
}

export async function attachListToCampaign(input: {
  entityId: string;
  listId: string;
  mode: 'attach' | 'create';
  campaignId?: string;
  draft?: { name?: string; subject?: string };
  actorId?: string | null;
}): Promise<
  | { ok: true; campaignId: string; mode: string }
  | { ok: false; error: string }
> {
  if (input.mode === 'attach' && input.campaignId) {
    const camp = await getCampaign(input.entityId, input.campaignId);
    if (!camp) return { ok: false, error: 'Campaign not found' };
    if (['sending', 'sent'].includes(camp.status)) {
      return {
        ok: false,
        error: 'Cannot change audience on sent campaign — clone instead',
      };
    }
    await updateCampaign(input.entityId, input.campaignId, {
      audience_type: 'list',
      audience_id: input.listId,
    });
    return { ok: true, campaignId: input.campaignId, mode: 'attach' };
  }

  const created = await createCampaign({
    entityId: input.entityId,
    name: input.draft?.name || 'Campaign from list',
    subject: input.draft?.subject || '',
    audienceType: 'list',
    audienceId: input.listId,
    createdBy: input.actorId,
  });
  if (!created) return { ok: false, error: 'create failed' };
  return { ok: true, campaignId: created.id, mode: 'create' };
}

export async function getAnalyticsOverview(entityId: string) {
  const sb = await createPersistClient({ mode: 'service' });
  const { data: campaigns } = await sb
    .from('ecc_campaigns')
    .select('id, status, stats_json, sent_at')
    .eq('entity_id', entityId)
    .order('sent_at', { ascending: false })
    .limit(100);

  let sent = 0;
  let skipped = 0;
  let errors = 0;
  for (const c of campaigns ?? []) {
    const s = (c.stats_json ?? {}) as Record<string, number>;
    sent += Number(s.sent ?? 0);
    skipped += Number(s.skipped ?? 0);
    errors += Number(s.errors ?? 0);
  }

  const { count: openEvents } = await sb
    .from('ecc_engagement_events')
    .select('*', { count: 'exact', head: true })
    .eq('entity_id', entityId)
    .eq('event_type', 'open');
  const { count: clickEvents } = await sb
    .from('ecc_engagement_events')
    .select('*', { count: 'exact', head: true })
    .eq('entity_id', entityId)
    .eq('event_type', 'click');

  return {
    campaigns: campaigns?.length ?? 0,
    sent,
    skipped,
    errors,
    opens: openEvents ?? 0,
    clicks: clickEvents ?? 0,
  };
}
