import { campaignDb } from '@/lib/campaign/db/client';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';

export async function POST(req: Request) {
  const secret = req.headers.get('x-postal-signature') || req.headers.get('x-mta-secret');
  if (
    process.env.POSTAL_WEBHOOK_SECRET &&
    secret !== process.env.POSTAL_WEBHOOK_SECRET
  ) {
    return jsonError('UNAUTHORIZED', 'Invalid webhook secret', 401);
  }
  const body = await readJson<{
    message_id?: string;
    status?: string;
    email?: string;
  }>(req);
  const sb = await campaignDb();
  if (body.message_id) {
    await sb
      .from('ecc_send_messages')
      .update({
        status: body.status === 'HardFail' ? 'bounced' : 'delivered',
      })
      .eq('provider_message_id', body.message_id);
  }
  return jsonOk({ ok: true });
}
