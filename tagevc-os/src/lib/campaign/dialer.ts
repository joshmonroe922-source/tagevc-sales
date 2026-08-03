import { campaignDb } from '@/lib/campaign/db/client';
import { canSendMarketing } from '@/lib/campaign/core/consent';

export async function recordDialerAttempt(input: {
  attemptId?: string; entityId: string; contactId: string; outcome: string;
  vmDropped?: boolean; enrollmentId?: string | null; stepId?: string | null;
  pairedEmailTemplateId?: string | null; ownerId?: string | null;
}) {
  const sb = await campaignDb();
  const vmDropped = input.vmDropped ?? input.outcome === 'vm_dropped';
  const { data: attempt } = await sb.from('ecc_dialer_attempts').insert({
    id: input.attemptId, entity_id: input.entityId, contact_id: input.contactId,
    owner_id: input.ownerId ?? null, enrollment_id: input.enrollmentId ?? null,
    step_id: input.stepId ?? null, outcome: input.outcome, vm_dropped: vmDropped,
    ended_at: new Date().toISOString(),
    metadata_json: { paired_email_template_id: input.pairedEmailTemplateId },
  }).select('id').single();
  const attemptId = String(attempt?.id || input.attemptId || '');
  const { data: existing } = await sb.from('ecc_paired_sends').select('attempt_id').eq('attempt_id', attemptId).maybeSingle();
  if (existing) return { attemptId, pairedEmailQueued: false, reason: 'already_processed' };
  if (input.outcome === 'answered') {
    await sb.from('ecc_paired_sends').insert({ attempt_id: attemptId, status: 'skipped_answered' });
    return { attemptId, pairedEmailQueued: false, reason: 'answered' };
  }
  const should = vmDropped && (input.outcome === 'vm_dropped' || input.outcome === 'no_answer');
  if (!should || !input.pairedEmailTemplateId) {
    await sb.from('ecc_paired_sends').insert({ attempt_id: attemptId, status: 'skipped_rules' });
    return { attemptId, pairedEmailQueued: false, reason: 'rules_not_met' };
  }
  const { data: contact } = await sb.from('contacts').select('primary_email, email_permission').eq('id', input.contactId).maybeSingle();
  if (!contact?.primary_email) return { attemptId, pairedEmailQueued: false, reason: 'no_email' };
  const gate = canSendMarketing({ email: contact.primary_email, permission: contact.email_permission });
  if (!gate.allow) {
    await sb.from('ecc_paired_sends').insert({ attempt_id: attemptId, status: `blocked:${gate.reason}` });
    return { attemptId, pairedEmailQueued: false, reason: gate.reason };
  }
  await sb.from('ecc_paired_sends').insert({
    attempt_id: attemptId, enrollment_id: input.enrollmentId ?? null, step_id: input.stepId ?? null, status: 'queued',
  });
  return { attemptId, pairedEmailQueued: true };
}
