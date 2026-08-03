import { campaignDb } from '@/lib/campaign/db/client';
import { canSendMarketing } from '@/lib/campaign/core/consent';
import { checkMutex, DEFAULT_MUTEX_POLICY } from '@/lib/campaign/core/mutex';
import { getEntitySettings } from '@/lib/campaign/auth';

export async function enrollContact(input: {
  entityId: string; contactId: string; journeyId: string; actorId?: string; source?: string;
}) {
  const sb = await campaignDb();
  const { data: journey } = await sb.from('ecc_journeys').select('*').eq('id', input.journeyId).maybeSingle();
  if (!journey || journey.entity_id !== input.entityId) return { ok: false as const, error: 'Journey not found' };
  const { data: contact } = await sb.from('contacts').select('primary_email, email_permission').eq('id', input.contactId).maybeSingle();
  if (!contact?.primary_email) return { ok: false as const, error: 'No email' };
  const gate = canSendMarketing({ email: contact.primary_email, permission: contact.email_permission });
  if (!gate.allow) return { ok: false as const, error: gate.reason };
  const { data: active } = await sb.from('ecc_journey_enrollments').select('id, journey_id').eq('contact_id', input.contactId).eq('entity_id', input.entityId).eq('state', 'active');
  const settings = await getEntitySettings(input.entityId);
  const mutex = checkMutex({
    active: (active ?? []).map((a) => ({ id: String(a.id), journeyId: String(a.journey_id), mutexGroup: null })),
    nextMutexGroup: journey.mutex_group,
    policy: { ...DEFAULT_MUTEX_POLICY, ...(settings.mutex_policy_json as any || {}) },
  });
  if (!mutex.ok) return { ok: false as const, error: mutex.message, code: 'CONFLICT', blocking: mutex.blockingEnrollmentIds };
  const { data, error } = await sb.from('ecc_journey_enrollments').insert({
    journey_id: input.journeyId, entity_id: input.entityId, contact_id: input.contactId,
    owner_id: input.actorId ?? null, state: 'active', source: input.source || 'api',
  }).select('id').single();
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, enrollmentId: data.id };
}

export async function pauseAllCadencesForContact(entityId: string, contactId: string, reason: string) {
  const sb = await campaignDb();
  await sb.from('ecc_conversation_state').upsert({
    contact_id: contactId, entity_id: entityId, state: 'conversing', reason, since: new Date().toISOString(),
  });
  const { data } = await sb.from('ecc_journey_enrollments').update({ state: 'paused', exit_reason: reason })
    .eq('contact_id', contactId).eq('entity_id', entityId).eq('state', 'active').select('id');
  return data?.length ?? 0;
}
