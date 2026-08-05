import { campaignDb } from '@/lib/campaign/db/client';
import { canSendMarketing } from '@/lib/campaign/core/consent';
import { checkMutex, DEFAULT_MUTEX_POLICY } from '@/lib/campaign/core/mutex';
import { getEntitySettings } from '@/lib/campaign/auth';

/**
 * Slim enroll — stores CRM context in metadata_json.
 * Does not run the full journey-runner (that lands with the ECC mega-PR).
 */
export async function enrollContact(input: {
  entityId: string;
  contactId: string;
  journeyId: string;
  actorId?: string;
  ownerId?: string;
  source?: string;
  /** CRM job/req merge context (stored in metadata_json). */
  metadata?: Record<string, unknown> | null;
}) {
  const sb = await campaignDb();
  const { data: journey } = await sb
    .from('ecc_journeys')
    .select('*')
    .eq('id', input.journeyId)
    .maybeSingle();
  if (!journey || journey.entity_id !== input.entityId) {
    return { ok: false as const, error: 'Journey not found' };
  }
  const { data: contact } = await sb
    .from('contacts')
    .select('primary_email, email_permission')
    .eq('id', input.contactId)
    .maybeSingle();
  if (!contact?.primary_email) return { ok: false as const, error: 'No email' };
  const gate = canSendMarketing({
    email: contact.primary_email,
    permission: contact.email_permission,
  });
  if (!gate.allow) return { ok: false as const, error: gate.reason };

  const { data: active } = await sb
    .from('ecc_journey_enrollments')
    .select('id, journey_id, ecc_journeys(mutex_group)')
    .eq('contact_id', input.contactId)
    .eq('entity_id', input.entityId)
    .eq('state', 'active');

  const settings = await getEntitySettings(input.entityId);
  const mutexPolicyJson =
    (settings as { mutex_policy_json?: Partial<typeof DEFAULT_MUTEX_POLICY> })
      .mutex_policy_json || {};
  const mutex = checkMutex({
    active: (active ?? []).map((a) => {
      const j = a.ecc_journeys as { mutex_group?: string } | null;
      return {
        id: String(a.id),
        journeyId: String(a.journey_id),
        mutexGroup: j?.mutex_group ?? null,
      };
    }),
    nextMutexGroup: journey.mutex_group,
    policy: {
      ...DEFAULT_MUTEX_POLICY,
      maxGlobal:
        Number((mutexPolicyJson as { maxGlobal?: number }).maxGlobal) ||
        DEFAULT_MUTEX_POLICY.maxGlobal,
      onConflict:
        ((mutexPolicyJson as { onConflict?: 'block' | 'replace' | 'queue' })
          .onConflict as 'block' | 'replace' | 'queue') || 'block',
    },
  });
  if (!mutex.ok) {
    return {
      ok: false as const,
      error: mutex.message,
      code: 'CONFLICT' as const,
      blocking: mutex.blockingEnrollmentIds,
    };
  }

  const triggerNode =
    (journey.graph_json as { nodes?: Array<{ id: string; type: string }> })
      ?.nodes?.find((n) => n.type === 'trigger')?.id || null;

  const { data, error } = await sb
    .from('ecc_journey_enrollments')
    .insert({
      journey_id: input.journeyId,
      entity_id: input.entityId,
      contact_id: input.contactId,
      owner_id: input.ownerId || input.actorId || null,
      state: 'active',
      source: input.source || 'api',
      current_node: triggerNode,
      metadata_json: input.metadata ?? {},
    })
    .select('id')
    .single();
  if (error) return { ok: false as const, error: error.message };

  return { ok: true as const, enrollmentId: data.id };
}

export async function pauseEnrollment(enrollmentId: string, reason: string) {
  const sb = await campaignDb();
  await sb
    .from('ecc_journey_enrollments')
    .update({ state: 'paused', exit_reason: reason })
    .eq('id', enrollmentId)
    .eq('state', 'active');
}

export async function exitEnrollment(enrollmentId: string, reason: string) {
  const sb = await campaignDb();
  await sb
    .from('ecc_journey_enrollments')
    .update({
      state: 'exited',
      exit_reason: reason,
      exited_at: new Date().toISOString(),
    })
    .eq('id', enrollmentId);
}
