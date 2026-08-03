import { requireCampaignAuth } from '@/lib/campaign/auth';
import { getBrandKit, upsertBrandKit } from '@/lib/campaign/db/repo';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';

export async function GET() {
  try {
    const auth = await requireCampaignAuth();
    return jsonOk({ data: await getBrandKit(auth.entityId) });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requireCampaignAuth();
    if (!auth.permissions.admin) {
      return jsonError('FORBIDDEN', 'Admin required', 403);
    }
    const body = await readJson(req);
    const row = await upsertBrandKit(auth.entityId, body);
    return jsonOk({ data: row });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
