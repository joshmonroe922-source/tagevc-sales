import { requireCampaignAuth } from '@/lib/campaign/auth';
import { listCampaigns } from '@/lib/campaign/db/repo';
import { jsonError, jsonOk } from '@/lib/campaign/http';

export async function GET(req: Request) {
  try {
    const auth = await requireCampaignAuth();
    if (!auth.permissions.viewTeam) {
      return jsonError('FORBIDDEN', 'view_team required', 403);
    }
    const url = new URL(req.url);
    const userId = url.searchParams.get('user_id') || undefined;
    // Hierarchy resolver stub: until org chart wired, entity admins see all; leads see filter
    const rows = await listCampaigns(auth.entityId, {
      ownerId: auth.permissions.viewEntity ? userId : userId || undefined,
    });
    return jsonOk({ data: rows, scope: 'downline_or_entity' });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
