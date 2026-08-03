/**
 * Consent gate + suppressions — checked at materialize AND just-in-time.
 * Default permission: opted_in. Inactive lifecycle ≠ opted out.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import type { ConsentGateResult } from '@/lib/campaign/types';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function isSuppressed(
  entityId: string,
  email: string,
): Promise<{ suppressed: boolean; reason?: string }> {
  const emailNorm = normalizeEmail(email);
  if (!emailNorm) return { suppressed: true, reason: 'empty_email' };
  const sb = await createPersistClient({ mode: 'service' });
  const { data } = await sb
    .from('ecc_suppressions')
    .select('reason, expires_at')
    .eq('entity_id', entityId)
    .eq('email_normalized', emailNorm)
    .maybeSingle();
  if (!data) return { suppressed: false };
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return { suppressed: false };
  }
  return { suppressed: true, reason: String(data.reason) };
}

export async function addSuppression(input: {
  entityId: string;
  email: string;
  reason: 'bounce_hard' | 'complaint' | 'unsub' | 'manual' | 'legal';
  source?: string;
}): Promise<void> {
  const sb = await createPersistClient({ mode: 'service' });
  await sb.from('ecc_suppressions').upsert(
    {
      entity_id: input.entityId,
      email_normalized: normalizeEmail(input.email),
      reason: input.reason,
      source: input.source ?? 'system',
    },
    { onConflict: 'entity_id,email_normalized' },
  );
}

export async function recordConsent(input: {
  entityId: string;
  contactId?: string | null;
  email: string;
  status: 'opt_in' | 'opt_out' | 'pending';
  topic?: string;
  source?: string;
  evidence?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  const sb = await createPersistClient({ mode: 'service' });
  await sb.from('ecc_consent_records').insert({
    entity_id: input.entityId,
    contact_id: input.contactId ?? null,
    email_normalized: normalizeEmail(input.email),
    channel: 'email',
    topic: input.topic ?? 'marketing',
    status: input.status,
    source: input.source ?? 'system',
    evidence_json: input.evidence ?? {},
    ip: input.ip ?? null,
    user_agent: input.userAgent ?? null,
  });

  if (input.status === 'opt_out') {
    await addSuppression({
      entityId: input.entityId,
      email: input.email,
      reason: 'unsub',
      source: input.source ?? 'unsub',
    });
    if (input.contactId) {
      await sb
        .from('contacts')
        .update({
          email_permission: 'opted_out',
          email_opted_out_at: new Date().toISOString(),
          email_opted_out_reason: input.source ?? 'unsub',
        })
        .eq('id', input.contactId);
    }
  }
}

export async function canSendMarketing(input: {
  entityId: string;
  contactId?: string | null;
  email: string;
  topic?: string;
}): Promise<ConsentGateResult> {
  const email = normalizeEmail(input.email);
  if (!email || !email.includes('@')) {
    return { allow: false, reason: 'invalid_email' };
  }

  const suppressed = await isSuppressed(input.entityId, email);
  if (suppressed.suppressed) {
    return { allow: false, reason: `suppressed:${suppressed.reason}` };
  }

  const sb = await createPersistClient({ mode: 'service' });

  if (input.contactId) {
    const { data: contact } = await sb
      .from('contacts')
      .select('email_permission')
      .eq('id', input.contactId)
      .maybeSingle();
    if (contact?.email_permission === 'opted_out') {
      return { allow: false, reason: 'opted_out' };
    }

    const { data: conv } = await sb
      .from('ecc_conversation_state')
      .select('state')
      .eq('contact_id', input.contactId)
      .eq('entity_id', input.entityId)
      .maybeSingle();
    if (conv?.state === 'conversing') {
      return { allow: false, reason: 'conversation_pause' };
    }
  }

  const { data: latest } = await sb
    .from('ecc_consent_records')
    .select('status')
    .eq('entity_id', input.entityId)
    .eq('email_normalized', email)
    .eq('channel', 'email')
    .eq('topic', input.topic ?? 'marketing')
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest?.status === 'opt_out') {
    return { allow: false, reason: 'consent_opt_out' };
  }

  return { allow: true };
}

export async function checkSuppressionsBatch(
  entityId: string,
  emails: string[],
): Promise<Array<{ email: string; suppressed: boolean; reason?: string }>> {
  const norms = emails.map(normalizeEmail).filter(Boolean);
  if (!norms.length) return [];
  const sb = await createPersistClient({ mode: 'service' });
  const { data } = await sb
    .from('ecc_suppressions')
    .select('email_normalized, reason')
    .eq('entity_id', entityId)
    .in('email_normalized', norms);
  const map = new Map(
    (data ?? []).map((r) => [String(r.email_normalized), String(r.reason)]),
  );
  return norms.map((email) => {
    const reason = map.get(email);
    return reason
      ? { email, suppressed: true, reason }
      : { email, suppressed: false };
  });
}
