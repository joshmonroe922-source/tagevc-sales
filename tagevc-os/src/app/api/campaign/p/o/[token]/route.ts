import { NextResponse } from 'next/server';
import { campaignDb } from '@/lib/campaign/db/client';
import { TRANSPARENT_GIF } from '@/lib/platform-email/mail-tracking';
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const sb = await campaignDb();
  const { data: msg } = await sb.from('ecc_send_messages').select('id, entity_id, contact_id, campaign_id').eq('tracking_token', token).maybeSingle();
  if (msg) {
    await sb.from('ecc_engagement_events').insert({
      entity_id: msg.entity_id, send_message_id: msg.id, contact_id: msg.contact_id, campaign_id: msg.campaign_id,
      event_type: 'open', user_agent: (req.headers.get('user-agent') || '').slice(0, 300),
    });
  }
  return new NextResponse(Buffer.from(TRANSPARENT_GIF), { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' } });
}
