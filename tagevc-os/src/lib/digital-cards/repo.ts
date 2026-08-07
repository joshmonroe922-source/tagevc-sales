/**
 * Digital card data access. User-scoped for My Card; service for public intake.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { createClient } from '@/lib/supabase/server';
import { entityDisplayName } from '@/lib/entities/display-name';
import { generatePublicId } from './public-id';
import { mapContact, mapPersona, mapTemplate } from './mappers';
import { defaultCtaForEntity, defaultThemeForEntity } from './theme';
import type {
  DigitalCardEventType,
  DigitalCardPersona,
  EntityCardTemplate,
  NetworkContact,
  ShareableField,
} from './types';

async function userClient() {
  return createClient();
}

export async function getTemplate(
  entityId: string,
  opts?: { service?: boolean },
): Promise<EntityCardTemplate | null> {
  try {
    const sb = opts?.service
      ? await createPersistClient({ mode: 'service' })
      : await createPersistClient({ mode: 'auto' });
    const { data, error } = await sb
      .from('os_digital_card_entity_templates')
      .select('*')
      .eq('entity_id', entityId)
      .maybeSingle();
    if (error || !data) return null;
    return mapTemplate(data as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function listTemplates(): Promise<EntityCardTemplate[]> {
  try {
    const sb = await createClient();
    const { data, error } = await sb
      .from('os_digital_card_entity_templates')
      .select('*')
      .order('entity_id');
    if (error || !data) return [];
    return data.map((r) => mapTemplate(r as Record<string, unknown>));
  } catch {
    return [];
  }
}

export async function upsertTemplate(
  input: Partial<EntityCardTemplate> & { entity_id: string },
): Promise<{ ok: true; template: EntityCardTemplate } | { ok: false; error: string }> {
  try {
    const sb = await createClient();
    const { data, error } = await sb
      .from('os_digital_card_entity_templates')
      .upsert(
        {
          entity_id: input.entity_id,
          default_cta: input.default_cta ?? defaultCtaForEntity(input.entity_id),
          locked_theme:
            input.locked_theme ?? defaultThemeForEntity(input.entity_id),
          required_share_fields: input.required_share_fields ?? ['work_email'],
          routing_defaults: input.routing_defaults ?? {},
          company_main_line: input.company_main_line ?? null,
          company_website: input.company_website ?? null,
          desk_public_id: input.desk_public_id ?? null,
        },
        { onConflict: 'entity_id' },
      )
      .select('*')
      .single();
    if (error || !data) {
      return { ok: false, error: error?.message || 'Template save failed' };
    }
    return { ok: true, template: mapTemplate(data as Record<string, unknown>) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Template save failed',
    };
  }
}

export async function getPersonaByPublicId(
  publicId: string,
  opts?: { service?: boolean },
): Promise<DigitalCardPersona | null> {
  try {
    const sb = opts?.service
      ? await createPersistClient({ mode: 'service' })
      : await createPersistClient({ mode: 'auto' });
    const { data, error } = await sb
      .from('os_digital_card_personas')
      .select('*')
      .eq('public_id', publicId)
      .maybeSingle();
    if (error || !data) return null;
    return mapPersona(data as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function getPersonaById(
  id: string,
): Promise<DigitalCardPersona | null> {
  try {
    const sb = await userClient();
    const { data, error } = await sb
      .from('os_digital_card_personas')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapPersona(data as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function listMyPersonas(
  userId: string,
): Promise<DigitalCardPersona[]> {
  try {
    const sb = await userClient();
    const { data, error } = await sb
      .from('os_digital_card_personas')
      .select('*')
      .eq('user_profile_id', userId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    if (error || !data) return [];
    return data.map((r) => mapPersona(r as Record<string, unknown>));
  } catch {
    return [];
  }
}

export type ActivatePersonaInput = {
  userProfileId: string;
  entityId: string;
  displayName: string;
  title?: string;
  department?: string;
  workEmail?: string;
  setDefault?: boolean;
};

export async function activatePersona(
  input: ActivatePersonaInput,
): Promise<
  | { ok: true; persona: DigitalCardPersona; created: boolean }
  | { ok: false; error: string }
> {
  try {
    const sb = await createPersistClient({ mode: 'service' });
    const { data: existing } = await sb
      .from('os_digital_card_personas')
      .select('*')
      .eq('user_profile_id', input.userProfileId)
      .eq('entity_id', input.entityId)
      .is('revoked_at', null)
      .maybeSingle();

    if (existing) {
      const emails: ShareableField[] = Array.isArray(existing.emails)
        ? (existing.emails as ShareableField[])
        : [];
      if (
        input.workEmail &&
        !emails.some(
          (e) =>
            e.value?.toLowerCase() === input.workEmail!.toLowerCase(),
        )
      ) {
        emails.unshift({
          label: 'Work',
          value: input.workEmail,
          share: true,
        });
      }
      const { data, error } = await sb
        .from('os_digital_card_personas')
        .update({
          display_name: input.displayName || existing.display_name,
          title: input.title ?? existing.title,
          department: input.department ?? existing.department,
          emails,
          is_active: true,
          revoked_at: null,
          revoke_message: null,
        })
        .eq('id', existing.id)
        .select('*')
        .single();
      if (error || !data) {
        return { ok: false, error: error?.message || 'Update failed' };
      }
      return {
        ok: true,
        persona: mapPersona(data as Record<string, unknown>),
        created: false,
      };
    }

    if (input.setDefault !== false) {
      await sb
        .from('os_digital_card_personas')
        .update({ is_default: false })
        .eq('user_profile_id', input.userProfileId)
        .eq('is_default', true);
    }

    const template = await getTemplate(input.entityId);
    const publicId = generatePublicId();
    const emails: ShareableField[] = input.workEmail
      ? [{ label: 'Work', value: input.workEmail, share: true }]
      : [];

    const { data, error } = await sb
      .from('os_digital_card_personas')
      .insert({
        user_profile_id: input.userProfileId,
        entity_id: input.entityId,
        public_id: publicId,
        display_name: input.displayName,
        title: input.title ?? '',
        department: input.department ?? '',
        emails,
        phones: [],
        socials: {},
        bio_short: '',
        cta_primary:
          template?.default_cta ?? defaultCtaForEntity(input.entityId),
        theme: template?.locked_theme ?? defaultThemeForEntity(input.entityId),
        is_default: input.setDefault !== false,
        is_active: true,
      })
      .select('*')
      .single();

    if (error || !data) {
      return { ok: false, error: error?.message || 'Create failed' };
    }
    return {
      ok: true,
      persona: mapPersona(data as Record<string, unknown>),
      created: true,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Activate failed',
    };
  }
}

export async function revokePersonasForUser(
  userProfileId: string,
  message?: string,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient({ mode: 'service' });
    const { data: rows } = await sb
      .from('os_digital_card_personas')
      .select('id, entity_id')
      .eq('user_profile_id', userProfileId)
      .is('revoked_at', null);

    const ids = (rows ?? []).map((r) => String(r.id));
    if (!ids.length) return { ok: true, count: 0 };

    const companyHint =
      rows?.[0]?.entity_id != null
        ? entityDisplayName(String(rows[0].entity_id))
        : 'the company';

    const { error } = await sb
      .from('os_digital_card_personas')
      .update({
        is_active: false,
        revoked_at: new Date().toISOString(),
        revoke_message:
          message?.trim() || `No longer with ${companyHint}`,
      })
      .in('id', ids);

    if (error) return { ok: false, error: error.message };
    return { ok: true, count: ids.length };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Revoke failed',
    };
  }
}

export async function updateMyPersona(
  userId: string,
  personaId: string,
  patch: Partial<{
    display_name: string;
    title: string;
    department: string;
    emails: ShareableField[];
    phones: ShareableField[];
    website: string | null;
    calendar_url: string | null;
    booking_url: string | null;
    socials: Record<string, string>;
    bio_short: string;
    photo_url: string | null;
    cta_primary: { label: string; url: string };
    is_default: boolean;
    event_tag: string | null;
    event_tag_remaining: number | null;
  }>,
): Promise<
  | { ok: true; persona: DigitalCardPersona }
  | { ok: false; error: string }
> {
  try {
    const sb = await userClient();
    const { data: existing } = await sb
      .from('os_digital_card_personas')
      .select('id, user_profile_id, entity_id')
      .eq('id', personaId)
      .maybeSingle();
    if (!existing || String(existing.user_profile_id) !== userId) {
      return { ok: false, error: 'Not allowed to edit this persona' };
    }

    if (patch.is_default) {
      await sb
        .from('os_digital_card_personas')
        .update({ is_default: false })
        .eq('user_profile_id', userId)
        .eq('is_default', true);
    }

    const update: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) update[k] = v;
    }
    // Never allow client to change identity/routing keys via this path
    delete update.public_id;
    delete update.user_profile_id;
    delete update.entity_id;
    delete update.theme;

    const { data, error } = await sb
      .from('os_digital_card_personas')
      .update(update)
      .eq('id', personaId)
      .eq('user_profile_id', userId)
      .select('*')
      .single();

    if (error || !data) {
      return { ok: false, error: error?.message || 'Update failed' };
    }
    return { ok: true, persona: mapPersona(data as Record<string, unknown>) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Update failed',
    };
  }
}

export async function recordCardEvent(input: {
  personaId: string | null;
  entityId: string;
  eventType: DigitalCardEventType;
  sourceChannel?: string;
  sourceDetail?: string;
  meta?: Record<string, unknown>;
  service?: boolean;
}): Promise<void> {
  try {
    const sb = input.service
      ? await createPersistClient({ mode: 'service' })
      : await createPersistClient({ mode: 'auto' });
    await sb.from('os_digital_card_events').insert({
      persona_id: input.personaId,
      entity_id: input.entityId,
      event_type: input.eventType,
      source_channel: input.sourceChannel || 'unknown',
      source_detail: input.sourceDetail ?? null,
      meta: input.meta ?? {},
    });
  } catch {
    /* fail-soft */
  }
}

export async function listMyContacts(
  userId: string,
  limit = 50,
): Promise<NetworkContact[]> {
  try {
    const sb = await userClient();
    const { data, error } = await sb
      .from('os_network_contacts')
      .select('*')
      .eq('owner_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map((r) => mapContact(r as Record<string, unknown>));
  } catch {
    return [];
  }
}

export async function getMyContact(
  userId: string,
  contactId: string,
): Promise<NetworkContact | null> {
  try {
    const sb = await userClient();
    const { data, error } = await sb
      .from('os_network_contacts')
      .select('*')
      .eq('id', contactId)
      .eq('owner_user_id', userId)
      .maybeSingle();
    if (error || !data) return null;
    return mapContact(data as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function updateContactStatus(
  userId: string,
  contactId: string,
  patch: Partial<{
    status: NetworkContact['status'];
    our_notes: string;
    linked_client_lead_id: string | null;
    linked_candidate_id: string | null;
  }>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sb = await userClient();
    const { error } = await sb
      .from('os_network_contacts')
      .update(patch)
      .eq('id', contactId)
      .eq('owner_user_id', userId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Update failed',
    };
  }
}

export async function insightsBySource(opts?: {
  entityId?: string;
  days?: number;
}): Promise<
  Array<{
    entity_id: string;
    source_channel: string;
    event_type: string;
    count: number;
  }>
> {
  try {
    const sb = await userClient();
    const since = new Date(
      Date.now() - (opts?.days ?? 30) * 24 * 60 * 60 * 1000,
    ).toISOString();
    let q = sb
      .from('os_digital_card_events')
      .select('entity_id, source_channel, event_type')
      .gte('created_at', since);
    if (opts?.entityId) q = q.eq('entity_id', opts.entityId);
    const { data, error } = await q.limit(5000);
    if (error || !data) return [];
    const map = new Map<string, number>();
    for (const row of data) {
      const key = `${row.entity_id}|${row.source_channel}|${row.event_type}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].map(([key, count]) => {
      const [entity_id, source_channel, event_type] = key.split('|');
      return { entity_id, source_channel, event_type, count };
    });
  } catch {
    return [];
  }
}
