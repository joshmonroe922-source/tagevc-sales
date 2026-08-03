import { requireCampaignAuth } from '@/lib/campaign/auth';
import { addListMembers } from '@/lib/campaign/db/repo';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await requireCampaignAuth();
    const body = await readJson<{ contact_ids?: string[] }>(req);
    const result = await addListMembers(id, body.contact_ids || []);
    return jsonOk({ data: result });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
