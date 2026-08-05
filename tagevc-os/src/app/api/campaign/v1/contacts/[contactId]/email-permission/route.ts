import { requireCampaignAuth } from '@/lib/campaign/auth';
import { recordConsent } from '@/lib/campaign/db/repo';
import { campaignDb } from '@/lib/campaign/db/client';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';

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

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { contactId } = await ctx.params;
    const auth = await requireCampaignAuth(req);
    const body = await readJson<{
      status?: 'opted_in' | 'opted_out';
      reason?: string;
    }>(req);
    const sb = await campaignDb();
    if (body.status === 'opted_out') {
      await recordConsent({
        entityId: auth.entityId,
        contactId,
        status: 'opt_out',
        source: body.reason || 'manual',
      });
    } else {
      await sb
        .from('contacts')
        .update({
          email_permission: 'opted_in',
          email_opted_out_at: null,
          email_opted_out_reason: null,
        })
        .eq('id', contactId);
      await recordConsent({
        entityId: auth.entityId,
        contactId,
        status: 'opt_in',
        source: body.reason || 'manual',
      });
    }
    return jsonOk({ data: { status: body.status } });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
