import { requireCampaignAuth } from '@/lib/campaign/auth';
import { getCampaign, updateCampaign, transitionCampaign } from '@/lib/campaign/db/repo';
import { scheduleCampaignSend } from '@/lib/campaign/workers/orchestrator';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';
import type { CampaignStatus } from '@/lib/campaign/core/types';
type Ctx = { params: Promise<{ id: string }> };
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const auth = await requireCampaignAuth();
    const row = await getCampaign(auth.entityId, id);
    if (!row) return jsonError('NOT_FOUND', 'Not found', 404);
    return jsonOk({ campaign: row });
  } catch (e) { return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400); }
}
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await readJson(req);
    const auth = await requireCampaignAuth();
    const action = String(body.action || 'update');
    if (action === 'update') {
      const row = await updateCampaign(auth.entityId, id, {
        name: body.name, subject: body.subject, body_html: body.body_html,
        audience_type: body.audience_type, audience_id: body.audience_id, template_id: body.template_id,
      });
      return jsonOk({ campaign: row });
    }
    if (action === 'send') {
      await transitionCampaign(auth.entityId, id, 'approved', auth.userId);
      const result = await scheduleCampaignSend({
        entityId: auth.entityId, campaignId: id, actorId: auth.userId,
        replyTo: String(body.replyTo || ''), userAccessToken: body.userAccessToken ? String(body.userAccessToken) : null,
      });
      return jsonOk({ ok: true, ...result });
    }
    const map: Record<string, CampaignStatus> = {
      submit: 'pending_approval', approve: 'approved', schedule: 'scheduled', pause: 'paused', cancel: 'cancelled',
    };
    const to = map[action];
    if (!to) return jsonError('VALIDATION', 'Unknown action', 422);
    const row = await transitionCampaign(auth.entityId, id, to, auth.userId, body.comment ? String(body.comment) : undefined);
    return jsonOk({ campaign: row });
  } catch (e) { return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400); }
}
