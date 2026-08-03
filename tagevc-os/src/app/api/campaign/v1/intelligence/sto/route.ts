import { requireCampaignAuth } from '@/lib/campaign/auth';
import { recomputePreferredHours } from '@/lib/campaign/intelligence';
import { jsonError, jsonOk } from '@/lib/campaign/http';

export async function POST() {
  try {
    const auth = await requireCampaignAuth();
    if (!auth.permissions.marketer) return jsonError('FORBIDDEN', 'Marketer role required', 403);
    return jsonOk({ data: await recomputePreferredHours(auth.entityId) });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
