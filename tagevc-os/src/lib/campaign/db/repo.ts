import { campaignDb } from './client';
import { assertTransition } from '@/lib/campaign/core/state-machine';
import type { CampaignStatus } from '@/lib/campaign/core/types';

export async function listCampaigns(entityId: string, opts?: { q?: string; status?: string; attachable?: boolean }) {
  const sb = await campaignDb();
  let q = sb.from('ecc_campaigns').select('*').eq('entity_id', entityId).order('updated_at', { ascending: false }).limit(100);
  if (opts?.status) q = q.eq('status', opts.status);
  if (opts?.attachable) q = q.in('status', ['draft','approved','scheduled']);
  if (opts?.q) q = q.ilike('name', `%${opts.q}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getCampaign(entityId: string, id: string) {
  const sb = await campaignDb();
  const { data, error } = await sb.from('ecc_campaigns').select('*').eq('entity_id', entityId).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function createCampaign(entityId: string, input: Record<string, unknown>) {
  const sb = await campaignDb();
  const { data, error } = await sb.from('ecc_campaigns').insert({
    entity_id: entityId,
    name: String(input.name || '').trim(),
    campaign_type: input.campaign_type || 'blast',
    subject: input.subject || '',
    body_html: input.body_html || '',
    template_id: input.template_id || null,
    audience_type: input.audience_type || null,
    audience_id: input.audience_id || null,
    delivery_plane: input.delivery_plane || 'controlled_graph',
    created_by: input.created_by || null,
    owner_id: input.owner_id || input.created_by || null,
    status: 'draft',
  }).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateCampaign(entityId: string, id: string, patch: Record<string, unknown>) {
  const sb = await campaignDb();
  const { data, error } = await sb.from('ecc_campaigns').update({ ...patch, updated_at: new Date().toISOString() })
    .eq('entity_id', entityId).eq('id', id).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}

export async function transitionCampaign(entityId: string, id: string, to: CampaignStatus, actorId: string, comment?: string) {
  const camp = await getCampaign(entityId, id);
  if (!camp) throw new Error('Campaign not found');
  assertTransition(camp.status as CampaignStatus, to);
  const sb = await campaignDb();
  await sb.from('ecc_campaign_approvals').insert({
    campaign_id: id, from_state: camp.status, to_state: to, actor_id: actorId, comment: comment || null,
  });
  return updateCampaign(entityId, id, { status: to, approval_state: to });
}

export async function listLists(entityId: string) {
  const sb = await campaignDb();
  const { data } = await sb.from('ecc_lists').select('*').eq('entity_id', entityId).order('updated_at', { ascending: false });
  return data ?? [];
}

export async function createList(entityId: string, name: string, createdBy?: string) {
  const sb = await campaignDb();
  const { data, error } = await sb.from('ecc_lists').insert({ entity_id: entityId, name, created_by: createdBy || null }).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}

export async function addListMembers(listId: string, contactIds: string[]) {
  if (!contactIds.length) return 0;
  const sb = await campaignDb();
  await sb.from('ecc_list_members').upsert(
    contactIds.map((contact_id) => ({ list_id: listId, contact_id, source: 'manual' })),
    { onConflict: 'list_id,contact_id', ignoreDuplicates: true },
  );
  const { count } = await sb.from('ecc_list_members').select('*', { count: 'exact', head: true }).eq('list_id', listId);
  await sb.from('ecc_lists').update({ count_cached: count ?? 0, updated_at: new Date().toISOString() }).eq('id', listId);
  return contactIds.length;
}

export async function listTemplates(entityId: string) {
  const sb = await campaignDb();
  const { data } = await sb.from('ecc_templates').select('*').eq('entity_id', entityId).neq('status', 'archived').order('updated_at', { ascending: false });
  return data ?? [];
}

export async function getRecipients(campaignId: string) {
  const sb = await campaignDb();
  const { data } = await sb.from('ecc_campaign_recipients').select('*').eq('campaign_id', campaignId).order('score', { ascending: false }).limit(200);
  return data ?? [];
}

export async function resolveAudience(entityId: string, audienceType: string | null, audienceId: string | null) {
  const sb = await campaignDb();
  if (audienceType === 'list' && audienceId) {
    const { data: members } = await sb.from('ecc_list_members').select('contact_id').eq('list_id', audienceId);
    const ids = (members ?? []).map((m) => String(m.contact_id));
    if (!ids.length) return [] as Array<{ id: string; email: string }>;
    const { data: contacts } = await sb.from('contacts').select('id, primary_email, email_permission, lifecycle, first_name, last_name, full_name, title').in('id', ids);
    return (contacts ?? []).filter((c) => c.primary_email).map((c) => ({
      id: String(c.id), email: String(c.primary_email),
      email_permission: c.email_permission, lifecycle: c.lifecycle,
      first_name: c.first_name, last_name: c.last_name, full_name: c.full_name, title: c.title,
    }));
  }
  return [];
}

export async function attachListToCampaign(entityId: string, listId: string, mode: 'attach'|'create', campaignId?: string, actorId?: string) {
  if (mode === 'attach' && campaignId) {
    const camp = await getCampaign(entityId, campaignId);
    if (!camp) throw new Error('Campaign not found');
    if (['sending','sent'].includes(camp.status)) throw new Error('Cannot change audience on sent campaign');
    await updateCampaign(entityId, campaignId, { audience_type: 'list', audience_id: listId });
    return campaignId;
  }
  const created = await createCampaign(entityId, {
    name: 'Campaign from list', audience_type: 'list', audience_id: listId, created_by: actorId,
  });
  return created.id as string;
}

export async function listMergeFields(_entityId: string) {
  const { DEFAULT_MERGE_FIELDS } = await import('@/lib/campaign/core/merge');
  return DEFAULT_MERGE_FIELDS.map((f) => ({
    object_name: f.object,
    api_name: f.api_name,
    label: f.label,
    data_type: f.data_type,
    sensitive: f.sensitive,
    allow: true,
    allow_merge: true,
  }));
}

export async function analyticsOverview(entityId: string) {
  const sb = await campaignDb();
  const [campaigns, events, recipients, journeys] = await Promise.all([
    sb.from('ecc_campaigns').select('id', { count: 'exact', head: true }).eq('entity_id', entityId),
    sb.from('ecc_engagement_events').select('event_type').eq('entity_id', entityId).limit(2000),
    sb.from('ecc_campaign_recipients').select('score, open_count, click_count, replied, campaign_id').limit(2000),
    sb.from('ecc_journeys').select('id', { count: 'exact', head: true }).eq('entity_id', entityId),
  ]);
  const byType: Record<string, number> = {};
  for (const e of events.data ?? []) {
    const t = String(e.event_type || 'unknown');
    byType[t] = (byType[t] || 0) + 1;
  }
  const scores = (recipients.data ?? []).map((r) => Number(r.score || 0));
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  return {
    campaigns: campaigns.count ?? 0,
    journeys: journeys.count ?? 0,
    engagement_events: (events.data ?? []).length,
    events_by_type: byType,
    recipients_sampled: scores.length,
    avg_engagement_score: Math.round(avgScore * 100) / 100,
    hot_recipients: scores.filter((s) => s >= 4).length,
    clicked_no_reply: (recipients.data ?? []).filter((r) => Number(r.click_count) > 0 && !r.replied).length,
  };
}

export async function listJourneys(entityId: string) {
  const sb = await campaignDb();
  const { data, error } = await sb
    .from('ecc_journeys')
    .select('*')
    .eq('entity_id', entityId)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getJourney(entityId: string, id: string) {
  const sb = await campaignDb();
  const { data, error } = await sb
    .from('ecc_journeys')
    .select('*')
    .eq('entity_id', entityId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function createJourney(entityId: string, input: Record<string, unknown>) {
  const sb = await campaignDb();
  const base = {
    entity_id: entityId,
    name: String(input.name || '').trim(),
    journey_type: input.journey_type || 'sequence',
    mutex_group: input.mutex_group ?? null,
    default_delivery_plane: input.default_delivery_plane || 'graph',
    graph_json: input.graph_json || { nodes: [], edges: [] },
    created_by: input.created_by || null,
    owner_id: input.owner_id || input.created_by || null,
    status: input.status || 'draft',
  };
  const enriched = {
    ...base,
    trigger_json: input.trigger_json || { type: 'manual' },
    goal_json: input.goal_json || {},
    reentry_policy: input.reentry_policy || 'allow_after_exit',
    starter_pack_key: input.starter_pack_key || null,
  };
  let { data, error } = await sb.from('ecc_journeys').insert(enriched).select('*').single();
  if (error && /column|trigger_json|goal_json|starter_pack/i.test(error.message)) {
    ({ data, error } = await sb.from('ecc_journeys').insert(base).select('*').single());
  }
  if (error) throw new Error(error.message);
  return data;
}

export async function updateJourney(entityId: string, id: string, patch: Record<string, unknown>) {
  const sb = await campaignDb();
  const { data, error } = await sb
    .from('ecc_journeys')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('entity_id', entityId)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}
