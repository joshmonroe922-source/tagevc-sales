import { requireCampaignAuth } from '@/lib/campaign/auth';
import { commandCenterHome } from '@/lib/campaign/db/repo';
import { jsonError, jsonOk } from '@/lib/campaign/http';

export async function GET() {
  try {
    const auth = await requireCampaignAuth();
    const data = await commandCenterHome(auth.entityId, auth.userId);
    return jsonOk({ data, service: 'marketing.email_campaign_center' });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
