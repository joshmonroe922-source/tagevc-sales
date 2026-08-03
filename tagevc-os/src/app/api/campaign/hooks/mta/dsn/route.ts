import { addSuppression } from '@/lib/campaign/db/repo';
import { campaignDb } from '@/lib/campaign/db/client';
import { jsonOk, readJson } from '@/lib/campaign/http';

export async function POST(req: Request) {
  const body = await readJson<{
    entity_id?: string;
    email?: string;
    bounce_type?: 'hard' | 'soft';
    provider_message_id?: string;
  }>(req);
  const sb = await campaignDb();
  if (body.provider_message_id) {
    await sb
      .from('ecc_send_messages')
      .update({
        status: 'bounced',
        bounce_type: body.bounce_type || 'hard',
      })
      .eq('provider_message_id', body.provider_message_id);
  }
  if (body.entity_id && body.email && body.bounce_type === 'hard') {
    await addSuppression(body.entity_id, body.email, 'bounce_hard', 'dsn');
  }
  return jsonOk({ ok: true });
}
