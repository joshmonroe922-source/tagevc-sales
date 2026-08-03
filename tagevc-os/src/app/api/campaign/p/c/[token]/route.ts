import { NextResponse } from 'next/server';
import { campaignDb } from '@/lib/campaign/db/client';
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const url = new URL(req.url);
  let target = url.searchParams.get('u') || '/';
  const sb = await campaignDb();
  const { data: msg } = await sb.from('ecc_send_messages').select('id, entity_id, contact_id, campaign_id').eq('tracking_token', token).maybeSingle();
  if (msg) {
    await sb.from('ecc_engagement_events').insert({
      entity_id: msg.entity_id, send_message_id: msg.id, contact_id: msg.contact_id, campaign_id: msg.campaign_id,
      event_type: 'click', url: target.slice(0, 2000),
    });
    if (msg.contact_id && msg.campaign_id) {
      const { data: r } = await sb.from('ecc_campaign_recipients').select('open_count, click_count, score').eq('campaign_id', msg.campaign_id).eq('contact_id', msg.contact_id).maybeSingle();
      await sb.from('ecc_campaign_recipients').upsert({
        campaign_id: msg.campaign_id, contact_id: msg.contact_id,
        open_count: Number(r?.open_count ?? 0), click_count: Number(r?.click_count ?? 0) + 1,
        score: Number(r?.score ?? 0) + 3, last_activity_at: new Date().toISOString(),
      });
    }
  }
  if (!/^https?:\/\//i.test(target)) target = '/';
  return NextResponse.redirect(target, 302);
}
