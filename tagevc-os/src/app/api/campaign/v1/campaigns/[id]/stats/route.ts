import { requireCampaignAuth } from '@/lib/campaign/auth';
import { getCampaign } from '@/lib/campaign/db/repo';
import { campaignDb } from '@/lib/campaign/db/client';
import { jsonError, jsonOk } from '@/lib/campaign/http';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const auth = await requireCampaignAuth();
    const campaign = await getCampaign(auth.entityId, id);
    if (!campaign) return jsonError('NOT_FOUND', 'Not found', 404);
    const sb = await campaignDb();
    const { count: sent } = await sb
      .from('ecc_send_messages')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', id)
      .eq('status', 'sent');
    const { count: opens } = await sb
      .from('ecc_engagement_events')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'open')
      .in(
        'send_message_id',
        (
          await sb.from('ecc_send_messages').select('id').eq('campaign_id', id)
        ).data?.map((r) => r.id) || ['00000000-0000-0000-0000-000000000000'],
      );
    const { count: clicks } = await sb
      .from('ecc_engagement_events')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'click')
      .in(
        'send_message_id',
        (
          await sb.from('ecc_send_messages').select('id').eq('campaign_id', id)
        ).data?.map((r) => r.id) || ['00000000-0000-0000-0000-000000000000'],
      );
    return jsonOk({
      data: {
        campaign_id: id,
        stats: campaign.stats_json,
        sent: sent ?? 0,
        opens: opens ?? 0,
        clicks: clicks ?? 0,
      },
    });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
