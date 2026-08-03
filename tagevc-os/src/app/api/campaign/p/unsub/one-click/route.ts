import { NextResponse } from 'next/server';
import { campaignDb } from '@/lib/campaign/db/client';
export async function POST(req: Request) {
  const url = new URL(req.url);
  let token = url.searchParams.get('token') || '';
  try {
    const body = await req.json();
    token = token || String(body.token || '');
  } catch { /* form */ }
  if (token) {
    const sb = await campaignDb();
    const { data: msg } = await sb.from('ecc_send_messages').select('*').eq('tracking_token', token).maybeSingle();
    if (msg?.email) {
      await sb.from('ecc_suppressions').upsert({
        entity_id: msg.entity_id, email_normalized: String(msg.email).toLowerCase(), reason: 'unsub', source: 'one_click',
      }, { onConflict: 'entity_id,email_normalized' });
      if (msg.contact_id) {
        await sb.from('contacts').update({
          email_permission: 'opted_out', email_opted_out_at: new Date().toISOString(), email_opted_out_reason: 'one_click',
        }).eq('id', msg.contact_id);
      }
      await sb.from('ecc_engagement_events').insert({
        entity_id: msg.entity_id, send_message_id: msg.id, contact_id: msg.contact_id, campaign_id: msg.campaign_id, event_type: 'unsub',
      });
    }
  }
  return new NextResponse(null, { status: 200 });
}
