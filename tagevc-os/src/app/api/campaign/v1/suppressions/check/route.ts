import { requireCampaignAuth } from '@/lib/campaign/auth';
import { checkSuppressions } from '@/lib/campaign/db/repo';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';

export async function POST(req: Request) {
  try {
    const auth = await requireCampaignAuth();
    const body = await readJson<{ emails?: string[] }>(req);
    const rows = await checkSuppressions(auth.entityId, body.emails || []);
    return jsonOk({ data: rows });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
