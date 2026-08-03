import { requireCampaignAuth } from '@/lib/campaign/auth';
import { scheduleCampaignSend } from '@/lib/campaign/workers/orchestrator';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';
import { getSessionContext } from '@/lib/rbac/session';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await readJson<{
      send_at?: string | null;
      reply_to?: string;
      user_access_token?: string;
    }>(req);
    const auth = await requireCampaignAuth();
    if (!auth.permissions.marketer) {
      return jsonError('FORBIDDEN', 'Marketer role required', 403);
    }
    const session = await getSessionContext();
    const replyTo = body.reply_to || session?.profile?.email || '';
    if (!replyTo.includes('@')) {
      return jsonError(
        'VALIDATION',
        'Bulk sends require Reply-To = user email',
      );
    }
    const result = await scheduleCampaignSend({
      entityId: auth.entityId,
      campaignId: id,
      actorId: auth.userId,
      sendAt: body.send_at || null,
      userAccessToken: body.user_access_token || null,
      replyTo,
    });
    return jsonOk({ data: result });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
