import { requireCampaignAuth } from '@/lib/campaign/auth';
import { loadIntelligenceDashboard } from '@/lib/campaign/intelligence';
import { jsonError, jsonOk } from '@/lib/campaign/http';

export async function GET() {
  try {
    const auth = await requireCampaignAuth();
    return jsonOk({ data: await loadIntelligenceDashboard(auth.entityId) });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
