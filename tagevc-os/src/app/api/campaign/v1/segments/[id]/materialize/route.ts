import { requireCampaignAuth } from '@/lib/campaign/auth';
import { materializeSegment } from '@/lib/campaign/db/repo';
import { jsonError, jsonOk } from '@/lib/campaign/http';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const auth = await requireCampaignAuth();
    const result = await materializeSegment(auth.entityId, id);
    return jsonOk({ data: result });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
