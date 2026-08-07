/**
 * Two-way exchange intake — public form → os_network_contacts.
 */

import { createHash, randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { getPersonaByPublicId, recordCardEvent } from './repo';
import { mapContact } from './mappers';
import { suggestRouting, buildDedupeSuggestions } from './routing';
import { hashedIpMeta } from './rate-limit';
import type { ExchangeSubmitInput, NetworkContact } from './types';

export type ExchangeResult =
  | {
      ok: true;
      contact_id: string;
      replay: boolean;
      dedupe: ReturnType<typeof buildDedupeSuggestions>;
      routing: ReturnType<typeof suggestRouting>;
    }
  | { ok: false; error: string; status: number };

function spamHeuristic(input: ExchangeSubmitInput): string | null {
  const name = (input.name || '').trim();
  if (name.length < 2) return 'name is required';
  if (/https?:\/\//i.test(name)) return 'invalid name';
  const note = (input.note || '') + (input.how_we_met || '');
  if ((note.match(/https?:\/\//gi) || []).length >= 3) {
    return 'too many links';
  }
  if (/viagra|crypto.?airdrop|seo.?service/i.test(note)) {
    return 'blocked';
  }
  return null;
}

export function buildExchangeIdempotencyKey(input: {
  publicId: string;
  email?: string;
  phone?: string;
  clientKey?: string;
}): string {
  if (input.clientKey?.trim()) {
    return input.clientKey.trim().slice(0, 128);
  }
  const day = new Date().toISOString().slice(0, 10);
  const raw = [
    input.publicId,
    (input.email || '').toLowerCase().trim(),
    (input.phone || '').replace(/\D/g, ''),
    day,
  ].join('|');
  return createHash('sha256').update(raw).digest('hex').slice(0, 64);
}

export async function submitExchange(
  body: ExchangeSubmitInput,
  opts?: { ip?: string | null },
): Promise<ExchangeResult> {
  // Honeypot
  if ((body.website || '').trim()) {
    return { ok: false, error: 'rejected', status: 400 };
  }

  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase() || undefined;
  const phone = (body.phone || '').trim() || undefined;
  if (!name) return { ok: false, error: 'name is required', status: 400 };
  if (!email && !phone) {
    return { ok: false, error: 'email or phone is required', status: 400 };
  }

  const spam = spamHeuristic(body);
  if (spam) return { ok: false, error: spam, status: 400 };

  const persona = await getPersonaByPublicId(body.public_id, { service: true });
  if (!persona) {
    return { ok: false, error: 'Card not found', status: 404 };
  }
  if (persona.revoked_at || !persona.is_active) {
    return { ok: false, error: 'Card is no longer active', status: 410 };
  }

  const externalId = buildExchangeIdempotencyKey({
    publicId: body.public_id,
    email,
    phone,
    clientKey: body.external_submission_id,
  });

  const sb = await createPersistClient({ mode: 'service' });

  const { data: existing } = await sb
    .from('os_network_contacts')
    .select('*')
    .eq('external_submission_id', externalId)
    .maybeSingle();

  if (existing) {
    const contact = mapContact(existing as Record<string, unknown>);
    return {
      ok: true,
      contact_id: contact.id,
      replay: true,
      dedupe: [],
      routing: contact.routing_suggestion ?? suggestRouting({
        entityId: persona.entity_id,
        intent: body.intent,
        note: body.note,
      }),
    };
  }

  // Event mode: inherit tag from persona
  let eventTag = persona.event_tag;
  if (
    eventTag &&
    persona.event_tag_remaining != null &&
    persona.event_tag_remaining > 0
  ) {
    await sb
      .from('os_digital_card_personas')
      .update({
        event_tag_remaining: Math.max(0, persona.event_tag_remaining - 1),
        event_tag:
          persona.event_tag_remaining - 1 <= 0 ? null : persona.event_tag,
      })
      .eq('id', persona.id);
  } else if (
    eventTag &&
    persona.event_tag_remaining != null &&
    persona.event_tag_remaining <= 0
  ) {
    eventTag = null;
  }

  const sourceChannel =
    (body.source_channel || '').trim() ||
    (eventTag ? `event_${eventTag}` : 'direct');

  const routing = suggestRouting({
    entityId: persona.entity_id,
    intent: body.intent,
    note: body.note,
    howWeMet: body.how_we_met,
    company: body.company,
  });

  // Soft dedupe against owner's recent contacts
  const { data: prior } = await sb
    .from('os_network_contacts')
    .select('id, email, phone')
    .eq('owner_user_id', persona.user_profile_id)
    .order('created_at', { ascending: false })
    .limit(100);

  const dedupe = buildDedupeSuggestions({
    email,
    phone,
    existingContacts: (prior ?? []).map((r) => ({
      id: String(r.id),
      email: r.email ? String(r.email) : null,
      phone: r.phone ? String(r.phone) : null,
    })),
  });

  const insertRow = {
    owner_user_id: persona.user_profile_id,
    entity_id: persona.entity_id,
    persona_id: persona.id,
    name,
    email: email ?? null,
    phone: phone ?? null,
    company: body.company?.trim() || null,
    title: body.title?.trim() || null,
    source_channel: sourceChannel.slice(0, 64),
    source_detail: body.source_detail?.trim() || null,
    entry_path: body.entry_path?.trim() || null,
    meeting_context: body.how_we_met?.trim() || null,
    event_tag: eventTag,
    their_notes: body.note?.trim() || null,
    consent_marketing: Boolean(body.consent_marketing),
    consent_at: body.consent_marketing ? new Date().toISOString() : null,
    external_submission_id: externalId,
    raw_payload: {
      intent: body.intent || null,
      received_at: new Date().toISOString(),
    },
    status: 'new',
    routing_suggestion: routing,
  };

  const { data: created, error } = await sb
    .from('os_network_contacts')
    .insert(insertRow)
    .select('*')
    .single();

  if (error || !created) {
    return {
      ok: false,
      error: error?.message || 'Could not save contact',
      status: 500,
    };
  }

  const contact = mapContact(created as Record<string, unknown>);

  await recordCardEvent({
    personaId: persona.id,
    entityId: persona.entity_id,
    eventType: 'exchange_submit',
    sourceChannel,
    meta: {
      ip_hash: hashedIpMeta(opts?.ip),
      contact_id: contact.id,
      dedupe_count: dedupe.length,
    },
    service: true,
  });

  // In-OS notify owner (fail-soft; service role — no owner session on public API)
  try {
    await sb.from('app_notifications').insert({
      notification_id: `NTF-${randomUUID().slice(0, 8)}`,
      user_id: persona.user_profile_id,
      kind: 'digital_card_exchange',
      title: `New card exchange · ${name}`,
      body: [
        companyLine(body.company, body.title),
        sourceChannel !== 'direct' ? `via ${sourceChannel}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      href: `/my-card/contacts/${contact.id}`,
    });
  } catch {
    /* fail-soft */
  }

  return {
    ok: true,
    contact_id: contact.id,
    replay: false,
    dedupe,
    routing,
  };
}

function companyLine(
  company?: string,
  title?: string,
): string | null {
  const bits = [title?.trim(), company?.trim()].filter(Boolean);
  return bits.length ? bits.join(' @ ') : null;
}

/** Human-gated: mark contact as linked client lead (Recruit). */
export async function linkContactAsClientLead(input: {
  userId: string;
  contactId: string;
  confirm: boolean;
}): Promise<
  | { ok: true; lead_id: string; contact: NetworkContact }
  | { ok: false; error: string }
> {
  if (!input.confirm) {
    return { ok: false, error: 'Human confirmation required' };
  }
  try {
    const sb = await createPersistClient({ mode: 'user' });
    const { data: row } = await sb
      .from('os_network_contacts')
      .select('*')
      .eq('id', input.contactId)
      .eq('owner_user_id', input.userId)
      .maybeSingle();
    if (!row) return { ok: false, error: 'Contact not found' };
    if (String(row.entity_id) !== 'ENT-R619') {
      return { ok: false, error: 'Client lead routing is Recruit 619 only' };
    }

    const leadId =
      (row.linked_client_lead_id as string) ||
      `CL-CARD-${randomUUID().slice(0, 8).toUpperCase()}`;

    // Soft lead stub — does not break Path A / website intake pipelines
    try {
      const service = await createPersistClient({ mode: 'service' });
      await service.from('os_recruit_card_lead_links').upsert(
        {
          lead_id: leadId,
          contact_id: input.contactId,
          owner_user_id: input.userId,
          company: row.company,
          contact_name: row.name,
          email: row.email,
          phone: row.phone,
          source: 'digital_card',
          status: 'open',
        },
        { onConflict: 'lead_id' },
      );
    } catch {
      /* table optional — status update still records intent */
    }

    const { data: updated, error } = await sb
      .from('os_network_contacts')
      .update({
        status: 'linked_lead',
        linked_client_lead_id: leadId,
        our_notes: [
          row.our_notes,
          `Linked client lead ${leadId} (human confirmed)`,
        ]
          .filter(Boolean)
          .join('\n'),
      })
      .eq('id', input.contactId)
      .select('*')
      .single();

    if (error || !updated) {
      return { ok: false, error: error?.message || 'Link failed' };
    }
    return {
      ok: true,
      lead_id: leadId,
      contact: mapContact(updated as Record<string, unknown>),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Link failed',
    };
  }
}

export async function linkContactAsCandidateInterest(input: {
  userId: string;
  contactId: string;
  confirm: boolean;
}): Promise<
  | { ok: true; candidate_id: string; contact: NetworkContact }
  | { ok: false; error: string }
> {
  if (!input.confirm) {
    return { ok: false, error: 'Human confirmation required' };
  }
  try {
    const sb = await createPersistClient({ mode: 'user' });
    const { data: row } = await sb
      .from('os_network_contacts')
      .select('*')
      .eq('id', input.contactId)
      .eq('owner_user_id', input.userId)
      .maybeSingle();
    if (!row) return { ok: false, error: 'Contact not found' };
    if (String(row.entity_id) !== 'ENT-R619') {
      return {
        ok: false,
        error: 'Candidate interest routing is Recruit 619 only',
      };
    }

    const candidateId =
      (row.linked_candidate_id as string) ||
      `GI-CARD-${randomUUID().slice(0, 8).toUpperCase()}`;

    try {
      const service = await createPersistClient({ mode: 'service' });
      await service.from('os_recruit_card_candidate_links').upsert(
        {
          candidate_id: candidateId,
          contact_id: input.contactId,
          owner_user_id: input.userId,
          name: row.name,
          email: row.email,
          phone: row.phone,
          source: 'digital_card_general_interest',
          status: 'open',
        },
        { onConflict: 'candidate_id' },
      );
    } catch {
      /* optional */
    }

    const { data: updated, error } = await sb
      .from('os_network_contacts')
      .update({
        status: 'linked_candidate',
        linked_candidate_id: candidateId,
        our_notes: [
          row.our_notes,
          `Linked general interest ${candidateId} (human confirmed)`,
        ]
          .filter(Boolean)
          .join('\n'),
      })
      .eq('id', input.contactId)
      .select('*')
      .single();

    if (error || !updated) {
      return { ok: false, error: error?.message || 'Link failed' };
    }
    return {
      ok: true,
      candidate_id: candidateId,
      contact: mapContact(updated as Record<string, unknown>),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Link failed',
    };
  }
}
