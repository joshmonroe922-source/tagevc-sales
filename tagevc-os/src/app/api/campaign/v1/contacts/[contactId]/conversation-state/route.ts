import { requireCampaignAuth } from '@/lib/campaign/auth';
import { campaignDb } from '@/lib/campaign/db/client';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';

type Ctx = { params: Promise<{ contactId: string }> };

/**
 * Pause all active enrollments for a contact (conversation mutex).
 * Slim surface for Recruit 619 EnrollmentService.pauseAllCadences.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { contactId } = await ctx.params;
    const auth = await requireCampaignAuth(req);
    const body = await readJson<{ reason?: string }>(req);
    const reason = body.reason || 'conversation';
    const sb = await campaignDb();
    const { data, error } = await sb
      .from('ecc_journey_enrollments')
      .update({ state: 'paused', exit_reason: reason })
      .eq('contact_id', contactId)
      .eq('entity_id', auth.entityId)
      .eq('state', 'active')
      .select('id');
    if (error) throw new Error(error.message);
    return jsonOk({ data: { ok: true, paused: data?.length ?? 0 } });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
