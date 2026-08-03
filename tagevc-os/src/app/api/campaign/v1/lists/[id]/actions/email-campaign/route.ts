import { requireCampaignAuth } from '@/lib/campaign/auth';
import { createCampaign, updateCampaign } from '@/lib/campaign/db/repo';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id: listId } = await ctx.params;
    const auth = await requireCampaignAuth();
    const body = await readJson<{
      mode?: 'attach' | 'create';
      campaign_id?: string;
      draft?: { name?: string; subject?: string; type?: string };
    }>(req);
    if (body.mode === 'attach' && body.campaign_id) {
      const row = await updateCampaign(
        auth.entityId,
        body.campaign_id,
        { audience_type: 'list', audience_id: listId },
        auth.userId,
      );
      return jsonOk({ data: { campaign_id: row.id, mode: 'attach' } });
    }
    const row = await createCampaign(auth.entityId, {
      name: body.draft?.name || `Campaign from list`,
      subject: body.draft?.subject || '',
      campaign_type: body.draft?.type || 'blast',
      audience_type: 'list',
      audience_id: listId,
      created_by: auth.userId,
      owner_id: auth.userId,
    });
    return jsonOk({ data: { campaign_id: row.id, mode: 'create' } }, 201);
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
