import { requireCampaignAuth } from '@/lib/campaign/auth';
import { getEccHome } from '@/lib/campaign/home';
import { jsonError, jsonOk } from '@/lib/campaign/http';
export async function GET() {
  try {
    const auth = await requireCampaignAuth();
    const home = await getEccHome(auth.entityId, auth.userId, auth.permissions.viewTeam);
    return jsonOk({ home, service: 'marketing.email_campaign_center' });
  } catch (e) { return jsonError('UNAUTHORIZED', e instanceof Error ? e.message : 'Unauthorized', 401); }
}
