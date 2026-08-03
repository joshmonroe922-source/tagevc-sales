import { requireCampaignAuth } from '@/lib/campaign/auth';
import { listMergeFields } from '@/lib/campaign/db/repo';
import { catalogToFields } from '@/lib/campaign/core/merge';
import { jsonError, jsonOk } from '@/lib/campaign/http';

export async function GET() {
  try {
    const auth = await requireCampaignAuth();
    const rows = await listMergeFields(auth.entityId);
    return jsonOk({
      data: catalogToFields(
        rows.map((r) => ({
          ...r,
          allow: r.allow !== false && r.allow_merge !== false,
        })),
      ),
    });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
