import { campaignDb } from '@/lib/campaign/db/client';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';

/**
 * Dialer → spine outcomes. call_vm_email: no_answer + vm_dropped → paired email once.
 */
export async function POST(req: Request) {
  const secret = req.headers.get('x-dialer-secret');
  if (
    process.env.DIALER_WEBHOOK_SECRET &&
    secret !== process.env.DIALER_WEBHOOK_SECRET
  ) {
    return jsonError('UNAUTHORIZED', 'Invalid dialer secret', 401);
  }
  const body = await readJson<{
    attempt_id?: string;
    entity_id?: string;
    contact_id?: string;
    owner_id?: string;
    enrollment_id?: string;
    step_id?: string;
    outcome?: string;
    vm_dropped?: boolean;
    vm_asset_id?: string;
    paired_email_template_id?: string;
    plane?: string;
  }>(req);

  if (!body.entity_id || !body.outcome) {
    return jsonError('VALIDATION', 'entity_id and outcome required');
  }

  const sb = await campaignDb();
  const attemptId = body.attempt_id;
  let attempt;
  if (attemptId) {
    const { data } = await sb
      .from('ecc_dialer_attempts')
      .upsert({
        id: attemptId,
        entity_id: body.entity_id,
        contact_id: body.contact_id || null,
        owner_id: body.owner_id || null,
        enrollment_id: body.enrollment_id || null,
        step_id: body.step_id || null,
        outcome: body.outcome,
        vm_dropped: Boolean(body.vm_dropped),
        vm_asset_id: body.vm_asset_id || null,
        ended_at: new Date().toISOString(),
      })
      .select('*')
      .single();
    attempt = data;
  } else {
    const { data } = await sb
      .from('ecc_dialer_attempts')
      .insert({
        entity_id: body.entity_id,
        contact_id: body.contact_id || null,
        owner_id: body.owner_id || null,
        enrollment_id: body.enrollment_id || null,
        step_id: body.step_id || null,
        outcome: body.outcome,
        vm_dropped: Boolean(body.vm_dropped),
        vm_asset_id: body.vm_asset_id || null,
        ended_at: new Date().toISOString(),
      })
      .select('*')
      .single();
    attempt = data;
  }

  const shouldPair =
    body.outcome === 'no_answer' &&
    Boolean(body.vm_dropped) &&
    Boolean(body.paired_email_template_id);

  if (shouldPair && attempt?.id) {
    const { data: existing } = await sb
      .from('ecc_paired_sends')
      .select('attempt_id')
      .eq('attempt_id', attempt.id)
      .maybeSingle();
    if (!existing) {
      await sb.from('ecc_paired_sends').insert({
        attempt_id: attempt.id,
        enrollment_id: body.enrollment_id || null,
        step_id: body.step_id || null,
        status: 'requested',
      });
      // Paired email enqueue is processed by send worker when Graph/MTA token available.
      await sb.from('ecc_audit_log').insert({
        entity_id: body.entity_id,
        action: 'dialer.paired_email_requested',
        object_type: 'dialer_attempt',
        object_id: attempt.id,
        after_json: {
          template_id: body.paired_email_template_id,
          plane: body.plane || 'graph',
          contact_id: body.contact_id,
        },
      });
    }
  }

  if (body.outcome === 'answered' && body.contact_id) {
    const { pauseConversation } = await import('@/lib/campaign/db/repo');
    await pauseConversation(
      body.entity_id,
      body.contact_id,
      'call_connected',
      body.owner_id,
    );
  }

  return jsonOk({ data: { attempt_id: attempt?.id, paired: shouldPair } });
}
