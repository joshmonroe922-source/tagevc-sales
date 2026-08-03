import { requireCampaignAuth } from '@/lib/campaign/auth';
import { transitionCampaign, updateCampaign } from '@/lib/campaign/db/repo';
import { jsonError, jsonOk } from '@/lib/campaign/http';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const auth = await requireCampaignAuth();
    await updateCampaign(auth.entityId, id, { kill_paused: true }, auth.userId);
    const row = await transitionCampaign(auth.entityId, id, 'paused', auth.userId);
    return jsonOk({ data: row });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
