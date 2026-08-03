import { requireCampaignAuth } from '@/lib/campaign/auth';
import { transitionCampaign } from '@/lib/campaign/db/repo';
import { jsonError, jsonOk } from '@/lib/campaign/http';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const auth = await requireCampaignAuth();
    const row = await transitionCampaign(
      auth.entityId,
      id,
      'pending_approval',
      auth.userId,
    );
    return jsonOk({ data: row });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
