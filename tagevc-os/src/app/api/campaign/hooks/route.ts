import { recordDialerAttempt } from '@/lib/campaign/dialer';
import { pauseAllCadencesForContact } from '@/lib/campaign/enrollment';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';
function okSecret(req: Request) {
  const expected = process.env.ECC_HOOK_SECRET?.trim();
  if (!expected) return process.env.NODE_ENV !== 'production';
  const got = req.headers.get('x-ecc-hook-secret') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return got === expected;
}
export async function POST(req: Request) {
  if (!okSecret(req)) return jsonError('UNAUTHORIZED', 'Unauthorized', 401);
  const kind = new URL(req.url).searchParams.get('kind') || 'dialer';
  const body = await readJson(req);
  if (kind === 'dialer') {
    return jsonOk(await recordDialerAttempt({
      attemptId: body.attempt_id ? String(body.attempt_id) : undefined,
      entityId: String(body.entity_id || 'ENT-FIRM'), contactId: String(body.contact_id || ''),
      outcome: String(body.outcome || ''), vmDropped: Boolean(body.vm_dropped),
      enrollmentId: body.enrollment_id ? String(body.enrollment_id) : null,
      pairedEmailTemplateId: body.paired_email_template_id ? String(body.paired_email_template_id) : null,
    }));
  }
  if (kind === 'reply' || kind === 'sms') {
    const n = await pauseAllCadencesForContact(String(body.entity_id || 'ENT-FIRM'), String(body.contact_id || ''), kind);
    return jsonOk({ paused: n });
  }
  return jsonOk({ accepted: true, kind });
}
