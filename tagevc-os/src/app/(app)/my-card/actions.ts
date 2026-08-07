'use server';

import { revalidatePath } from 'next/cache';
import { getSessionContext } from '@/lib/rbac/session';
import {
  activatePersona,
  countMyNewContacts,
  listMyPersonas,
  updateMyPersona,
  updateContactStatus,
} from '@/lib/digital-cards/repo';
import {
  linkContactAsCandidateInterest,
  linkContactAsClientLead,
} from '@/lib/digital-cards/exchange';
import type { ShareableField } from '@/lib/digital-cards/types';

async function requireUser() {
  const ctx = await getSessionContext();
  const userId = ctx?.profile?.id;
  if (!userId) throw new Error('Not signed in');
  return { userId, ctx };
}

export async function ensureMyCardAction() {
  const { userId, ctx } = await requireUser();
  const existing = await listMyPersonas(userId);
  if (existing.length) {
    return { ok: true as const, personas: existing };
  }
  const entityId = ctx?.profile?.entity_id || 'ENT-FIRM';
  const name =
    [ctx?.profile?.full_name, ctx?.profile?.email]
      .map((v) => (typeof v === 'string' ? v : null))
      .find(Boolean) || 'Team member';
  const result = await activatePersona({
    userProfileId: userId,
    entityId,
    displayName: String(name),
    title: ctx?.profile?.job_title || undefined,
    workEmail: ctx?.profile?.email || undefined,
    setDefault: true,
  });
  if (!result.ok) return { ok: false as const, error: result.error };
  revalidatePath('/my-card');
  return { ok: true as const, personas: [result.persona] };
}

export async function updatePersonaAction(input: {
  personaId: string;
  display_name?: string;
  title?: string;
  department?: string;
  bio_short?: string;
  website?: string | null;
  phones?: ShareableField[];
  emails?: ShareableField[];
  socials?: Record<string, string>;
  photo_url?: string | null;
  is_default?: boolean;
  event_tag?: string | null;
  event_tag_remaining?: number | null;
}) {
  const { userId } = await requireUser();
  const { personaId, ...patch } = input;
  const result = await updateMyPersona(userId, personaId, patch);
  if (!result.ok) return { ok: false as const, error: result.error };
  revalidatePath('/my-card');
  return { ok: true as const, persona: result.persona };
}

export async function markContactFollowedUpAction(contactId: string) {
  const { userId } = await requireUser();
  const result = await updateContactStatus(userId, contactId, {
    status: 'followed_up',
  });
  revalidatePath('/my-card');
  revalidatePath(`/my-card/contacts/${contactId}`);
  return result.ok
    ? { ok: true as const }
    : { ok: false as const, error: result.error };
}

export async function createClientLeadFromContactAction(input: {
  contactId: string;
  confirm: boolean;
}) {
  const { userId } = await requireUser();
  const result = await linkContactAsClientLead({
    userId,
    contactId: input.contactId,
    confirm: input.confirm,
  });
  revalidatePath('/my-card');
  revalidatePath(`/my-card/contacts/${input.contactId}`);
  return result;
}

export async function addGeneralInterestFromContactAction(input: {
  contactId: string;
  confirm: boolean;
}) {
  const { userId } = await requireUser();
  const result = await linkContactAsCandidateInterest({
    userId,
    contactId: input.contactId,
    confirm: input.confirm,
  });
  revalidatePath('/my-card');
  revalidatePath(`/my-card/contacts/${input.contactId}`);
  return result;
}

export async function getNewNetworkContactsCountAction() {
  const ctx = await getSessionContext();
  const userId = ctx?.profile?.id;
  if (!userId) return { ok: false as const, count: 0 };
  const count = await countMyNewContacts(userId);
  return { ok: true as const, count };
}

export async function draftThankYouNoteAction(input: {
  contactName: string;
  company?: string | null;
  context?: string | null;
}) {
  // AI DRAFT only — human sends. Fail-soft template, no live model required.
  const company = input.company?.trim();
  const ctx = input.context?.trim();
  const draft = [
    `Hi ${input.contactName.split(' ')[0] || input.contactName},`,
    '',
    `Great connecting${company ? ` — especially learning about ${company}` : ''}.`,
    ctx ? `Appreciate you sharing: ${ctx}` : null,
    '',
    'Happy to follow up whenever useful.',
    '',
    'Best,',
  ]
    .filter((line) => line !== null)
    .join('\n');
  return { ok: true as const, draft, mode: 'DRAFT' as const };
}
