import { requireCampaignAuth } from '@/lib/campaign/auth';
import { campaignDb } from '@/lib/campaign/db/client';
import { jsonError, jsonOk } from '@/lib/campaign/http';

type Ctx = { params: Promise<{ id: string }> };

/** DNS verify stub — marks verified when CAMPAIGN_DNS_TRUST=1 or all flags mocked. */
export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const auth = await requireCampaignAuth();
    const sb = await campaignDb();
    const trust = process.env.CAMPAIGN_DNS_TRUST === '1';
    const { data, error } = await sb
      .from('ecc_sending_domains')
      .update({
        spf_ok: trust,
        dkim_ok: trust,
        dmarc_ok: trust,
        status: trust ? 'verified' : 'pending',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('entity_id', auth.entityId)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return jsonOk({ data, trusted: trust });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
