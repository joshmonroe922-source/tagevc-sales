import { requireCampaignAuth } from '@/lib/campaign/auth';
import { getCampaignRecipients } from '@/lib/campaign/db/repo';
import { jsonError, jsonOk } from '@/lib/campaign/http';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const auth = await requireCampaignAuth();
    const rows = await getCampaignRecipients(auth.entityId, id, {
      sort: url.searchParams.get('sort') || 'score',
      filter: url.searchParams.get('filter') || undefined,
    });
    return jsonOk({ data: rows });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
