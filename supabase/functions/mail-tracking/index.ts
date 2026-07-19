import {
  base64UrlDecode,
  TRANSPARENT_GIF,
} from '../_shared/mailTracking.ts';
import { createServiceClient } from '../_shared/supabase.ts';

const GIF_HEADERS = {
  'Content-Type': 'image/gif',
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  'Pragma': 'no-cache',
};

function clientIp(req: Request): string | null {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-real-ip') ??
    null
  );
}

async function recordEvent(
  token: string,
  eventType: 'email.opened' | 'email.clicked',
  opts: {
    clickUrl?: string | null;
    userAgent?: string | null;
    ip?: string | null;
  },
): Promise<void> {
  const supabase = createServiceClient();
  const occurredAt = new Date().toISOString();

  const { data: message } = await supabase
    .from('sales_email_messages')
    .select('id, open_count, click_count, first_opened_at, first_clicked_at')
    .eq('tracking_token', token)
    .maybeSingle();

  if (!message) {
    console.warn('mail-tracking: unknown token', token.slice(0, 8));
    return;
  }

  const { error: insertErr } = await supabase.from('sales_email_events').insert({
    message_id: message.id,
    tracking_token: token,
    event_type: eventType,
    click_url: opts.clickUrl ?? null,
    user_agent: opts.userAgent ?? null,
    ip_address: opts.ip ?? null,
    payload: {},
    occurred_at: occurredAt,
  });

  if (insertErr) {
    console.error('mail-tracking event insert failed', insertErr);
    return;
  }

  const patch: Record<string, unknown> = { updated_at: occurredAt };
  if (eventType === 'email.opened') {
    patch.open_count = (message.open_count ?? 0) + 1;
    patch.last_opened_at = occurredAt;
    if (!message.first_opened_at) patch.first_opened_at = occurredAt;
  } else {
    patch.click_count = (message.click_count ?? 0) + 1;
    patch.last_clicked_at = occurredAt;
    if (!message.first_clicked_at) patch.first_clicked_at = occurredAt;
  }

  await supabase.from('sales_email_messages').update(patch).eq('id', message.id);
}

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(req.url);
  const action = (url.searchParams.get('action') ?? '').toLowerCase();
  const token = (url.searchParams.get('t') ?? '').trim();

  if (!token || token.length < 16) {
    return new Response('Not found', { status: 404 });
  }

  const userAgent = req.headers.get('user-agent');
  const ip = clientIp(req);

  if (action === 'open') {
    if (req.method === 'GET') {
      await recordEvent(token, 'email.opened', { userAgent, ip });
    }
    return new Response(TRANSPARENT_GIF, { status: 200, headers: GIF_HEADERS });
  }

  if (action === 'click') {
    const encoded = url.searchParams.get('u') ?? '';
    let destination = '';
    try {
      destination = base64UrlDecode(encoded);
    } catch {
      return new Response('Bad link', { status: 400 });
    }
    if (!/^https?:\/\//i.test(destination)) {
      return new Response('Bad link', { status: 400 });
    }
    if (req.method === 'GET') {
      await recordEvent(token, 'email.clicked', {
        clickUrl: destination,
        userAgent,
        ip,
      });
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: destination,
        'Cache-Control': 'no-store',
      },
    });
  }

  return new Response('Not found', { status: 404 });
});
