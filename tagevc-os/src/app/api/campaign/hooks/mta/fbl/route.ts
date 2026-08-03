import { addSuppression } from '@/lib/campaign/db/repo';
import { jsonOk, readJson } from '@/lib/campaign/http';

export async function POST(req: Request) {
  const body = await readJson<{ entity_id?: string; email?: string }>(req);
  if (body.entity_id && body.email) {
    await addSuppression(body.entity_id, body.email, 'complaint', 'fbl');
  }
  return jsonOk({ ok: true });
}
