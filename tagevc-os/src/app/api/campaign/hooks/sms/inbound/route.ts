import { pauseConversation } from '@/lib/campaign/db/repo';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';

export async function POST(req: Request) {
  const body = await readJson<{
    entity_id?: string;
    contact_id?: string;
  }>(req);
  if (!body.entity_id || !body.contact_id) {
    return jsonError('VALIDATION', 'entity_id and contact_id required');
  }
  await pauseConversation(body.entity_id, body.contact_id, 'sms_inbound');
  return jsonOk({ ok: true });
}
