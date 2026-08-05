import { requireCampaignAuth } from '@/lib/campaign/auth';
import { pauseConversation } from '@/lib/campaign/db/repo';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';

type Ctx = { params: Promise<{ contactId: string }> };

/**
 * Pause all active enrollments for a contact (conversation mutex).
 * Used by Recruit 619 EnrollmentService.pauseAllCadences.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { contactId } = await ctx.params;
    const auth = await requireCampaignAuth(req);
    const body = await readJson<{ reason?: string }>(req);
    await pauseConversation(
      auth.entityId,
      contactId,
      body.reason || 'manual',
      auth.userId,
    );
    return jsonOk({ data: { ok: true } });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
