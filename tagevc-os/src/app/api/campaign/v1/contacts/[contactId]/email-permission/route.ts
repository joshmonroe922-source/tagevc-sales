import { requireCampaignAuth } from '@/lib/campaign/auth';
import { campaignDb } from '@/lib/campaign/db/client';
import { jsonError, jsonOk } from '@/lib/campaign/http';

type Ctx = { params: Promise<{ contactId: string }> };

/** Read contact email permission for Recruit 619 EnrollmentService. */
export async function GET(req: Request, ctx: Ctx) {
  try {
    const { contactId } = await ctx.params;
    await requireCampaignAuth(req);
    const sb = await campaignDb();
    const { data, error } = await sb
      .from('contacts')
      .select('id, email_permission')
      .eq('id', contactId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const status =
      data?.email_permission === 'opted_out' ||
      data?.email_permission === 'opted_in'
        ? data.email_permission
        : 'unknown';
    return jsonOk({
      data: { status, email_permission: status },
    });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
