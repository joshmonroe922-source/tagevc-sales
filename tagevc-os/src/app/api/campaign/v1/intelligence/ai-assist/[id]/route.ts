import { requireCampaignAuth } from '@/lib/campaign/auth';
import { reviewAiAssistDraft } from '@/lib/campaign/intelligence';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCampaignAuth();
    if (!auth.permissions.marketer) return jsonError('FORBIDDEN', 'Marketer role required', 403);
    const { id } = await ctx.params;
    const body = await readJson<{ status?: 'approved' | 'rejected' | 'applied' }>(req);
    if (!body.status || !['approved', 'rejected', 'applied'].includes(body.status)) {
      return jsonError('VALIDATION', 'status must be approved|rejected|applied');
    }
    const data = await reviewAiAssistDraft(auth.entityId, id, auth.userId, body.status);
    return jsonOk({ data, auto_send_allowed: false });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
