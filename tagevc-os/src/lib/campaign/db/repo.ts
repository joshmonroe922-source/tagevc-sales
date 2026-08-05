import { campaignDb } from './client';
import { enrollContact as enrollContactCore } from '@/lib/campaign/enrollment';

/** Throwing enroll wrapper used by the contact enrollments API route. */
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
