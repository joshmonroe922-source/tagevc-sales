import { campaignDb } from '@/lib/campaign/db/client';
import {
  attributionLite,
  draftAiAssist,
  preferredSendHour,
  templateWinRates,
  type AiAssistTone,
  type AttributionEvent,
  LIFT_EXPERIMENT_FRAMEWORK,
} from '@/lib/campaign/core/intelligence';
import { scoreEngagement } from '@/lib/campaign/core/engagement';

function band(score: number): string {
  if (score >= 8) return 'hot';
  if (score >= 4) return 'warm';
  if (score >= 1) return 'cool';
  return 'cold';
}

export async function loadIntelligenceDashboard(entityId: string) {
  const sb = await campaignDb();
  let eventRows: Array<{
    event_type: string;
    occurred_at: string;
    url?: string | null;
    hour_local?: number | null;
    utm_json?: unknown;
    contact_id?: string | null;
    campaign_id?: string | null;
  }> = [];
  {
    const full = await sb
      .from('ecc_engagement_events')
      .select('event_type, occurred_at, url, hour_local, utm_json, contact_id, campaign_id')
      .eq('entity_id', entityId)
      .order('occurred_at', { ascending: false })
      .limit(3000);
    if (full.error) {
      const basic = await sb
        .from('ecc_engagement_events')
        .select('event_type, occurred_at, url, contact_id, campaign_id')
        .eq('entity_id', entityId)
        .order('occurred_at', { ascending: false })
        .limit(3000);
      eventRows = (basic.data ?? []) as typeof eventRows;
    } else {
      eventRows = (full.data ?? []) as typeof eventRows;
    }
  }

  const recipientsRes = await sb
    .from('ecc_campaign_recipients')
    .select('contact_id, score, open_count, click_count, replied, last_activity_at, campaign_id')
    .limit(2000);

  const draftsRes = await sb
    .from('ecc_ai_assist_drafts')
    .select('id, kind, status, tone, suggestion_text, created_at')
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false })
    .limit(20);

  const recipientIds = [
    ...new Set((recipientsRes.data ?? []).map((r) => String(r.contact_id)).filter(Boolean)),
  ].slice(0, 200);

  const contactsRes = recipientIds.length
    ? await sb
        .from('contacts')
        .select(
          'id, engagement_score, preferred_send_hour, engagement_band, primary_email, full_name, first_name',
        )
        .in('id', recipientIds)
    : { data: [] as Array<Record<string, unknown>> };

  const heatmap = new Array(24).fill(0);
  for (const e of eventRows) {
    const hour =
      typeof e.hour_local === 'number' ? e.hour_local : new Date(String(e.occurred_at)).getHours();
    if (hour >= 0 && hour < 24) {
      const w =
        e.event_type === 'click' ? 3 : e.event_type === 'reply' ? 5 : e.event_type === 'open' ? 1 : 0.5;
      heatmap[hour] += w;
    }
  }
  const sto = preferredSendHour(heatmap);

  const bandCounts = { hot: 0, warm: 0, cool: 0, cold: 0 };
  for (const c of contactsRes.data ?? []) {
    const score = Number((c as { engagement_score?: number }).engagement_score || 0);
    const b = String((c as { engagement_band?: string }).engagement_band || band(score)) as keyof typeof bandCounts;
    if (b in bandCounts) bandCounts[b] += 1;
    else bandCounts[band(score) as keyof typeof bandCounts] += 1;
  }

  const attrEvents: AttributionEvent[] = [];
  for (const e of eventRows) {
    const t = String(e.event_type);
    if (!['click', 'call', 'reply', 'sign', 'docusign_completed'].includes(t)) continue;
    if (!e.contact_id) continue;
    attrEvents.push({
      type: t === 'docusign_completed' ? 'sign' : (t as AttributionEvent['type']),
      at: String(e.occurred_at),
      contactId: String(e.contact_id),
      campaignId: e.campaign_id ? String(e.campaign_id) : null,
    });
  }
  const attr = attributionLite(attrEvents);

  const templateRows = await sb
    .from('ecc_templates')
    .select('id, name')
    .eq('entity_id', entityId)
    .limit(50);
  const winRates = templateWinRates(
    (templateRows.data ?? []).map((t) => ({
      templateId: String(t.id),
      templateName: String(t.name),
      sends: 0,
      opens: 0,
      clicks: 0,
      replies: 0,
    })),
  );

  return {
    entity_preferred_hour: sto.samples ? sto.hour : null,
    sto_confidence: sto.confidence,
    heatmap,
    band_counts: bandCounts,
    top_contacts: (contactsRes.data ?? [])
      .map((c) => {
        const score = Number((c as { engagement_score?: number }).engagement_score || 0);
        return {
          id: String((c as { id: string }).id),
          name:
            (c as { full_name?: string }).full_name ||
            (c as { first_name?: string }).first_name ||
            (c as { primary_email?: string }).primary_email ||
            'Contact',
          email: (c as { primary_email?: string | null }).primary_email ?? null,
          score,
          band: (c as { engagement_band?: string }).engagement_band || band(score),
          preferred_send_hour: (c as { preferred_send_hour?: number | null }).preferred_send_hour ?? null,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 25),
    people_filters: {
      hot: (recipientsRes.data ?? []).filter((r) => Number(r.score) >= 4).length,
      clicked_no_reply: (recipientsRes.data ?? []).filter(
        (r) => Number(r.click_count) > 0 && !r.replied,
      ).length,
      opened: (recipientsRes.data ?? []).filter((r) => Number(r.open_count) > 0).length,
    },
    attribution: {
      sampled_touches: attrEvents.length,
      path_preview: attr.paths.slice(0, 8).map((p) => p.path),
      click_to_call: attr.clickToCall,
      call_to_sign: attr.callToSign,
      click_to_sign: attr.clickToSign,
      clicked: attrEvents.some((e) => e.type === 'click'),
      called: attrEvents.some((e) => e.type === 'call'),
      signed: attrEvents.some((e) => e.type === 'sign'),
    },
    template_wins: winRates.slice(0, 8),
    ai_drafts: draftsRes.error ? [] : draftsRes.data ?? [],
    lift_experiment_note: LIFT_EXPERIMENT_FRAMEWORK.principles.join(' · '),
  };
}

export async function recomputePreferredHours(entityId: string, limit = 500) {
  const sb = await campaignDb();
  const { data: events } = await sb
    .from('ecc_engagement_events')
    .select('contact_id, event_type, occurred_at, hour_local')
    .eq('entity_id', entityId)
    .not('contact_id', 'is', null)
    .limit(5000);

  const byContact = new Map<string, number[]>();
  for (const e of events ?? []) {
    const cid = String(e.contact_id);
    const hist = byContact.get(cid) || new Array(24).fill(0);
    const hour =
      typeof e.hour_local === 'number' ? e.hour_local : new Date(String(e.occurred_at)).getHours();
    if (hour >= 0 && hour < 24) {
      hist[hour] += e.event_type === 'click' ? 3 : e.event_type === 'reply' ? 5 : 1;
    }
    byContact.set(cid, hist);
  }

  let updated = 0;
  for (const contactId of [...byContact.keys()].slice(0, limit)) {
    const sto = preferredSendHour(byContact.get(contactId) || []);
    const { data: c } = await sb
      .from('contacts')
      .select('engagement_score')
      .eq('id', contactId)
      .maybeSingle();
    const score = Number(c?.engagement_score || 0);
    const { error } = await sb
      .from('contacts')
      .update({
        preferred_send_hour: sto.samples ? sto.hour : null,
        engagement_band: band(score || scoreEngagement({})),
      })
      .eq('id', contactId);
    if (!error) updated += 1;
  }
  return { updated, contacts_with_signal: byContact.size, entityId };
}

export async function createAiAssistDraft(
  entityId: string,
  actorId: string,
  input: {
    kind?: 'subject' | 'body' | 'rewrite';
    sourceText: string;
    tone?: AiAssistTone;
    brandVoice?: string;
    campaignId?: string;
    templateId?: string;
    subject?: string;
  },
) {
  const draft = draftAiAssist({
    subject: input.subject || input.sourceText.split('\n')[0] || 'Quick note',
    body_html: input.sourceText.includes('<')
      ? input.sourceText
      : `<p>${input.sourceText.replace(/\n/g, '</p><p>')}</p>`,
    tone: input.tone,
    brandVoice: input.brandVoice,
  });

  const suggestions = [
    {
      id: 'ai_primary',
      kind: input.kind || 'rewrite',
      text: `${draft.subject}\n\n${draft.body_html.replace(/<[^>]+>/g, ' ').trim()}`,
      tone: input.tone || 'professional',
      autoSendAllowed: false as const,
      rationale: draft.rationale,
    },
  ];

  const sb = await campaignDb();
  const { data, error } = await sb
    .from('ecc_ai_assist_drafts')
    .insert({
      entity_id: entityId,
      campaign_id: input.campaignId || null,
      template_id: input.templateId || null,
      kind: input.kind || 'rewrite',
      source_text: input.sourceText,
      suggestion_text: suggestions[0].text,
      tone: input.tone || 'professional',
      status: 'suggested',
      auto_send_allowed: false,
      created_by: actorId,
    })
    .select('*')
    .single();

  if (error) {
    return { draft: null, suggestions, persist_error: error.message, quality: draft.score };
  }
  return { draft: data, suggestions, quality: draft.score };
}

export async function reviewAiAssistDraft(
  entityId: string,
  draftId: string,
  actorId: string,
  status: 'approved' | 'rejected' | 'applied',
) {
  const sb = await campaignDb();
  const { data, error } = await sb
    .from('ecc_ai_assist_drafts')
    .update({
      status,
      reviewed_by: actorId,
      updated_at: new Date().toISOString(),
      auto_send_allowed: false,
    })
    .eq('entity_id', entityId)
    .eq('id', draftId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}
