import { requireCampaignAuth } from '@/lib/campaign/auth';
import { analyticsOverview } from '@/lib/campaign/db/repo';
import { jsonError, jsonOk } from '@/lib/campaign/http';

export async function GET() {
  try {
    const auth = await requireCampaignAuth();
    return jsonOk({ data: await analyticsOverview(auth.entityId) });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
