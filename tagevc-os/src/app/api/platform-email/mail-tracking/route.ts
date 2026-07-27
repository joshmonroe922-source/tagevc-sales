import { NextRequest, NextResponse } from 'next/server';
import {
  base64UrlDecode,
  TRANSPARENT_GIF,
} from '@/lib/platform-email/mail-tracking';
import { createPersistClient } from '@/lib/supabase/persist-client';

export const runtime = 'nodejs';

const GIF_HEADERS = {
  'Content-Type': 'image/gif',
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  Pragma: 'no-cache',
};

function clientIp(req: NextRequest): string | null {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    null
  );
}

async function recordEvent(
  token: string,
  eventType: 'open' | 'click',
  opts: {
    clickUrl?: string | null;
    userAgent?: string | null;
    ip?: string | null;
  },
): Promise<void> {
  const supabase = await createPersistClient();
  if (!supabase) return;

  const occurredAt = new Date().toISOString();
  const { data: msg } = await supabase
    .from('os_platform_email_messages')
    .select('id, entity_id, open_count, click_count, first_opened_at, first_clicked_at')
    .eq('tracking_token', token)
    .maybeSingle();

  if (!msg?.id) {
    // Fail-soft: table missing or unknown token — still serve pixel/redirect.
    console.info('[platform-email] tracking event (no message row)', {
      token: token.slice(0, 8),
      eventType,
    });
    return;
  }

  await supabase.from('os_platform_email_events').insert({
    message_id: msg.id,
    entity_id: msg.entity_id,
    tracking_token: token,
    event_type: eventType,
    click_url: opts.clickUrl ?? null,
    user_agent: opts.userAgent ?? null,
    ip_address: opts.ip ?? null,
    occurred_at: occurredAt,
  });

  if (eventType === 'open') {
    await supabase
      .from('os_platform_email_messages')
      .update({
        open_count: (msg.open_count ?? 0) + 1,
        last_opened_at: occurredAt,
        first_opened_at: msg.first_opened_at ?? occurredAt,
        updated_at: occurredAt,
      })
      .eq('id', msg.id);
  } else {
    await supabase
      .from('os_platform_email_messages')
      .update({
        click_count: (msg.click_count ?? 0) + 1,
        last_clicked_at: occurredAt,
        first_clicked_at: msg.first_clicked_at ?? occurredAt,
        updated_at: occurredAt,
      })
      .eq('id', msg.id);
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const action = (url.searchParams.get('action') ?? '').toLowerCase();
  const token = (url.searchParams.get('t') ?? '').trim();

  if (!token || token.length < 16) {
    return new NextResponse('Not found', { status: 404 });
  }

  const ua = req.headers.get('user-agent');
  const ip = clientIp(req);

  if (action === 'open') {
    try {
      await recordEvent(token, 'open', { userAgent: ua, ip });
    } catch (err) {
      console.warn('[platform-email] open record failed', err);
    }
    return new NextResponse(TRANSPARENT_GIF, { status: 200, headers: GIF_HEADERS });
  }

  if (action === 'click') {
    const enc = (url.searchParams.get('u') ?? '').trim();
    let destination = '/';
    try {
      destination = enc ? base64UrlDecode(enc) : '/';
    } catch {
      destination = '/';
    }
    if (!/^https?:\/\//i.test(destination)) {
      destination = '/';
    }
    try {
      await recordEvent(token, 'click', {
        clickUrl: destination,
        userAgent: ua,
        ip,
      });
    } catch (err) {
      console.warn('[platform-email] click record failed', err);
    }
    return NextResponse.redirect(destination, 302);
  }

  return new NextResponse('Not found', { status: 404 });
}
