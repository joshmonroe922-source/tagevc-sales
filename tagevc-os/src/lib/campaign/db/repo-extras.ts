/**
 * Remaining ECC repo helpers expected by v1 routes + hooks.
 * Additive on the core CRUD above — keep entity_id scoped.
 */

import { campaignDb } from './client';
import { scoreEngagement } from '@/lib/campaign/core/engagement';
import {
  evaluateSegment,
  type ContactLike,
} from '@/lib/campaign/core/segment-dsl';
import type { SegmentDefinition } from '@/lib/campaign/core/types';
import {
  addSuppression as consentAddSuppression,
  recordConsent as consentRecordConsent,
  checkSuppressionsBatch,
} from '@/lib/campaign/consent';
import {
  enrollContact as enrollContactCore,
  pauseAllCadencesForContact as pauseCadencesCore,
} from '@/lib/campaign/enrollment';
import { getEccHome } from '@/lib/campaign/home';
import {
  matchesRecipientFilter,
  type RecipientFilter,
} from '@/lib/campaign/engagement';

// ---------------------------------------------------------------------------
// Brand kit
// ---------------------------------------------------------------------------

export async function getBrandKit(entityId: string) {
  const sb = await campaignDb();
  const { data } = await sb
    .from('ecc_brand_kits')
    .select('*')
    .eq('entity_id', entityId)
    .maybeSingle();
  if (data) return data;
  const { data: settings } = await sb
    .from('ecc_entity_settings')
    .select('physical_address, brand_kit_json')
    .eq('entity_id', entityId)
    .maybeSingle();
  return {
    entity_id: entityId,
    logo_url: null,
    colors_json: {},
    fonts_json: {},
    footer_html: null,
    physical_address: settings?.physical_address || '',
    social_json: {},
    ...(typeof settings?.brand_kit_json === 'object' ? settings.brand_kit_json : {}),
  };
}

export async function upsertBrandKit(
  entityId: string,
  patch: Record<string, unknown>,
) {
  const sb = await campaignDb();
  const row = {
    entity_id: entityId,
    logo_url: patch.logo_url ?? null,
    colors_json: patch.colors_json ?? {},
    fonts_json: patch.fonts_json ?? {},
    footer_html: patch.footer_html ?? null,
    physical_address: String(patch.physical_address || ''),
    social_json: patch.social_json ?? {},
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await sb
    .from('ecc_brand_kits')
    .upsert(row, { onConflict: 'entity_id' })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// ---------------------------------------------------------------------------
// Suppressions / consent (route-shaped adapters)
// ---------------------------------------------------------------------------

export async function addSuppression(
  entityId: string,
  email: string,
  reason: string,
  source = 'api',
) {
  const allowed = [
    'bounce_hard',
    'complaint',
    'unsub',
    'manual',
    'legal',
  ] as const;
  const r = (allowed as readonly string[]).includes(reason)
    ? (reason as (typeof allowed)[number])
    : 'manual';
  await consentAddSuppression({ entityId, email, reason: r, source });
  const sb = await campaignDb();
  const { data } = await sb
    .from('ecc_suppressions')
    .select('*')
    .eq('entity_id', entityId)
    .eq('email_normalized', email.trim().toLowerCase())
    .maybeSingle();
  return data;
}

export async function checkSuppressions(entityId: string, emails: string[]) {
  return checkSuppressionsBatch(entityId, emails);
}

export async function recordConsent(input: {
  entityId: string;
  contactId?: string | null;
  email?: string;
  status: 'opt_in' | 'opt_out' | 'pending';
  topic?: string;
  source?: string;
  evidence?: Record<string, unknown>;
}) {
  let email = input.email;
  if (!email && input.contactId) {
    const sb = await campaignDb();
    const { data } = await sb
      .from('contacts')
      .select('primary_email')
      .eq('id', input.contactId)
      .maybeSingle();
    email = data?.primary_email ? String(data.primary_email) : undefined;
  }
  if (!email) throw new Error('email required for consent record');
  await consentRecordConsent({
    entityId: input.entityId,
    contactId: input.contactId,
    email,
    status: input.status,
    topic: input.topic,
    source: input.source,
    evidence: input.evidence,
  });
}

// ---------------------------------------------------------------------------
// Conversation pause
// ---------------------------------------------------------------------------

export async function pauseConversation(
  entityId: string,
  contactId: string,
  reason: string,
  actorId?: string | null,
) {
  const sb = await campaignDb();
  await sb.from('ecc_conversation_state').upsert(
    {
      contact_id: contactId,
      entity_id: entityId,
      state: 'conversing',
      reason,
      since: new Date().toISOString(),
      actor_id: actorId ?? null,
    },
    { onConflict: 'contact_id,entity_id' },
  );
  return pauseCadencesCore(entityId, contactId, reason);
}

// ---------------------------------------------------------------------------
// Enroll (throws for API routes)
// ---------------------------------------------------------------------------

export async function enrollContact(input: {
  entityId: string;
  contactId: string;
  journeyId: string;
  ownerId?: string;
  actorId?: string;
  source?: string;
  metadata?: Record<string, unknown> | null;
}) {
  const result = await enrollContactCore({
    entityId: input.entityId,
    contactId: input.contactId,
    journeyId: input.journeyId,
    actorId: input.ownerId || input.actorId,
    source: input.source,
    metadata: input.metadata,
  });
  if (!result.ok) {
    const err = new Error(result.error) as Error & {
      status?: number;
      details?: unknown;
      code?: string;
    };
    if ('code' in result && result.code === 'CONFLICT') {
      err.status = 409;
      err.details = { blocking: result.blocking };
    }
    throw err;
  }
  const sb = await campaignDb();
  const { data } = await sb
    .from('ecc_journey_enrollments')
    .select('*')
    .eq('id', result.enrollmentId)
    .single();
  return data;
}

// ---------------------------------------------------------------------------
// Home / recipients / scores
// ---------------------------------------------------------------------------

export async function commandCenterHome(entityId: string, userId: string) {
  return getEccHome(entityId, userId, true);
}

export async function getCampaignRecipients(
  entityId: string,
  campaignId: string,
  opts?: { sort?: string; filter?: string },
) {
  const sb = await campaignDb();
  const { data: camp } = await sb
    .from('ecc_campaigns')
    .select('id')
    .eq('entity_id', entityId)
    .eq('id', campaignId)
    .maybeSingle();
  if (!camp) throw new Error('Campaign not found');
  const { data } = await sb
    .from('ecc_campaign_recipients')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('score', { ascending: false })
    .limit(500);
  let rows = data ?? [];
  const filter = (opts?.filter || 'all') as RecipientFilter;
  rows = rows.filter((r) =>
    matchesRecipientFilter(
      {
        open_count: Number(r.open_count || 0),
        click_count: Number(r.click_count || 0),
        replied: Boolean(r.replied),
        score: Number(r.score || 0),
      },
      filter,
    ),
  );
  if (opts?.sort === 'email') {
    rows = [...rows].sort((a, b) =>
      String(a.email || '').localeCompare(String(b.email || '')),
    );
  }
  return rows;
}

export async function bumpRecipientScore(sendMessageId: string) {
  const sb = await campaignDb();
  const { data: msg } = await sb
    .from('ecc_send_messages')
    .select('id, campaign_id, contact_id, entity_id')
    .eq('id', sendMessageId)
    .maybeSingle();
  if (!msg?.campaign_id || !msg.contact_id) return;

  const { data: events } = await sb
    .from('ecc_engagement_events')
    .select('event_type')
    .eq('send_message_id', sendMessageId);

  const openCount = (events ?? []).filter((e) => e.event_type === 'open').length;
  const clickCount = (events ?? []).filter((e) => e.event_type === 'click').length;
  const replied = (events ?? []).some((e) => e.event_type === 'reply');
  const score = scoreEngagement({ openCount, clickCount, replied });

  await sb.from('ecc_campaign_recipients').upsert(
    {
      campaign_id: msg.campaign_id,
      contact_id: msg.contact_id,
      open_count: openCount,
      click_count: clickCount,
      replied,
      score,
      last_activity_at: new Date().toISOString(),
    },
    { onConflict: 'campaign_id,contact_id' },
  );

  await sb
    .from('contacts')
    .update({ engagement_score: score })
    .eq('id', msg.contact_id);
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

export async function listSegments(entityId: string) {
  const sb = await campaignDb();
  const { data, error } = await sb
    .from('ecc_segments')
    .select('*')
    .eq('entity_id', entityId)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createSegment(
  entityId: string,
  input: {
    name: string;
    definition_json?: SegmentDefinition;
    created_by?: string;
  },
) {
  const sb = await campaignDb();
  const { data, error } = await sb
    .from('ecc_segments')
    .insert({
      entity_id: entityId,
      name: input.name.trim(),
      definition_json: input.definition_json || { op: 'and', rules: [] },
      created_by: input.created_by || null,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function previewSegment(
  entityId: string,
  definition: SegmentDefinition,
) {
  const sb = await campaignDb();
  const { data: contacts } = await sb
    .from('contacts')
    .select(
      'id, primary_email, first_name, last_name, title, lifecycle, email_permission, engagement_score',
    )
    .eq('entity_id', entityId)
    .limit(500);
  const matched = (contacts ?? []).filter((c) =>
    evaluateSegment(c as ContactLike, definition),
  );
  return {
    count: matched.length,
    samples: matched.slice(0, 10).map((c) => ({
      id: c.id,
      email: c.primary_email,
      name: [c.first_name, c.last_name].filter(Boolean).join(' ') || null,
    })),
  };
}

export async function materializeSegment(entityId: string, segmentId: string) {
  const sb = await campaignDb();
  const { data: seg } = await sb
    .from('ecc_segments')
    .select('*')
    .eq('id', segmentId)
    .eq('entity_id', entityId)
    .maybeSingle();
  if (!seg) throw new Error('Segment not found');

  const def = (seg.definition_json || {
    op: 'and',
    rules: [],
  }) as SegmentDefinition;
  const { data: contacts } = await sb
    .from('contacts')
    .select('id, primary_email, lifecycle, email_permission, engagement_score')
    .eq('entity_id', entityId)
    .limit(5000);
  const matched = (contacts ?? []).filter((c) =>
    evaluateSegment(c as ContactLike, def),
  );

  // Soft-clear prior members by marking exited, then upsert active
  await sb
    .from('ecc_segment_members')
    .update({ exited_at: new Date().toISOString() })
    .eq('segment_id', segmentId)
    .is('exited_at', null);

  if (matched.length) {
    await sb.from('ecc_segment_members').upsert(
      matched.map((c) => ({
        segment_id: segmentId,
        contact_id: c.id,
        entered_at: new Date().toISOString(),
        exited_at: null,
      })),
      { onConflict: 'segment_id,contact_id' },
    );
  }

  await sb
    .from('ecc_segments')
    .update({
      count_cached: matched.length,
      last_materialized_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', segmentId);

  return { count: matched.length, segment_id: segmentId };
}
