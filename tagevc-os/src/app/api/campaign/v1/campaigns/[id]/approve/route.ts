import { requireCampaignAuth } from '@/lib/campaign/auth';
import { transitionCampaign } from '@/lib/campaign/db/repo';
import { jsonError, jsonOk } from '@/lib/campaign/http';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const auth = await requireCampaignAuth();
    if (!auth.permissions.approver) {
      return jsonError('FORBIDDEN', 'Approver role required', 403);
    }
    const row = await transitionCampaign(auth.entityId, id, 'approved', auth.userId);
    return jsonOk({ data: row });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
