import { NextResponse } from 'next/server';
import { campaignDb } from '@/lib/campaign/db/client';

function esc(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const sb = await campaignDb();
  const { data: msg } = await sb.from('ecc_send_messages').select('email, entity_id').eq('tracking_token', token).maybeSingle();
  const email = msg?.email ? esc(String(msg.email)) : '';
  const html = `<!doctype html><html><body style="font-family:Georgia,serif;background:#ece9e6;color:#3a414f;padding:48px 20px;max-width:520px;margin:0 auto">
<h1>Email preferences</h1>
<p>${email ? `Managing <strong>${email}</strong>` : 'Update preferences'}</p>
<form method="POST" style="background:#fff;border:1px solid #d7d3c3;border-radius:8px;padding:24px">
<button name="intent" value="unsub_all" style="background:#3a414f;color:#ece9e6;border:0;padding:12px 16px;border-radius:6px;cursor:pointer">Unsubscribe from all</button>
</form></body></html>`;
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const sb = await campaignDb();
  const { data: msg } = await sb.from('ecc_send_messages').select('*').eq('tracking_token', token).maybeSingle();
  if (msg?.email) {
    await sb.from('ecc_suppressions').upsert({
      entity_id: msg.entity_id, email_normalized: String(msg.email).toLowerCase(), reason: 'unsub', source: 'pref_center',
    }, { onConflict: 'entity_id,email_normalized' });
    if (msg.contact_id) {
      await sb.from('contacts').update({
        email_permission: 'opted_out', email_opted_out_at: new Date().toISOString(), email_opted_out_reason: 'pref_center',
      }).eq('id', msg.contact_id);
    }
  }
  return new NextResponse(
    '<html><body style="font-family:Georgia,serif;padding:48px;background:#ece9e6"><h1>Saved</h1></body></html>',
    { headers: { 'Content-Type': 'text/html' } },
  );
}
