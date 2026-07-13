import { createServiceClient } from '../_shared/supabase.ts';
import { recordOutboundEmail } from '../_shared/emailAnalytics.ts';

/**
 * Resend webhooks use Svix signing.
 * Headers: svix-id, svix-timestamp, svix-signature
 * Secret: RESEND_WEBHOOK_SECRET (whsec_…)
 */

type ResendWebhookPayload = {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    message_id?: string;
    from?: string;
    to?: string[];
    subject?: string;
    created_at?: string;
    tags?: Record<string, string>;
    click?: {
      ipAddress?: string;
      link?: string;
      timestamp?: string;
      userAgent?: string;
    };
    bounce?: {
      message?: string;
      type?: string;
    };
  };
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function decodeWhsec(secret: string): Uint8Array {
  const raw = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const bin = atob(raw);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function verifySvixSignature(
  body: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  secret: string,
): Promise<boolean> {
  const ts = Number(svixTimestamp);
  if (!Number.isFinite(ts)) return false;
  // Reject stale timestamps (±5 minutes)
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > 300) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    decodeWhsec(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const toSign = `${svixId}.${svixTimestamp}.${body}`;
  const sigBuf = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(toSign),
  );
  const computed = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));

  const candidates = svixSignature
    .split(' ')
    .map((part) => {
      const [, b64] = part.split(',');
      return b64?.trim() ?? '';
    })
    .filter(Boolean);

  return candidates.some((c) => timingSafeEqual(c, computed));
}

function sourceFromTags(tags?: Record<string, string>): string {
  const s = tags?.source;
  if (s && s.length > 0) return s;
  return 'webhook';
}

function leadIdFromTags(tags?: Record<string, string>): string | null {
  const id = tags?.lead_id;
  if (!id) return null;
  // UUID-ish after sanitize (hyphens preserved)
  if (/^[0-9a-fA-F-]{36}$/.test(id)) return id;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200 });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET');
  if (!secret) {
    console.error('RESEND_WEBHOOK_SECRET not set');
    return new Response(JSON.stringify({ error: 'Webhook not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const bodyText = await req.text();
  const svixId = req.headers.get('svix-id') ?? '';
  const svixTimestamp = req.headers.get('svix-timestamp') ?? '';
  const svixSignature = req.headers.get('svix-signature') ?? '';

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response(JSON.stringify({ error: 'Missing Svix headers' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const ok = await verifySvixSignature(
    bodyText,
    svixId,
    svixTimestamp,
    svixSignature,
    secret,
  );
  if (!ok) {
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: ResendWebhookPayload;
  try {
    payload = JSON.parse(bodyText) as ResendWebhookPayload;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const eventType = payload.type ?? 'unknown';
  const data = payload.data ?? {};
  const resendId = data.email_id;
  if (!resendId) {
    // Ignore non-email events (domain.*, contact.*)
    return new Response(JSON.stringify({ ok: true, ignored: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createServiceClient();
  const occurredAt =
    data.click?.timestamp ||
    payload.created_at ||
    data.created_at ||
    new Date().toISOString();

  // Ensure message row exists (covers Auth SMTP / pre-feature sends that still webhook)
  let { data: message } = await supabase
    .from('sales_email_messages')
    .select('id, open_count, click_count, first_opened_at, first_clicked_at')
    .eq('resend_id', resendId)
    .maybeSingle();

  if (!message) {
    const tags = data.tags ?? {};
    await recordOutboundEmail(supabase, {
      resendId,
      to: data.to ?? [],
      subject: data.subject ?? '',
      source: sourceFromTags(tags),
      leadId: leadIdFromTags(tags),
      fromAddress: data.from ?? null,
      tags,
      status: 'sent',
    });
    const again = await supabase
      .from('sales_email_messages')
      .select('id, open_count, click_count, first_opened_at, first_clicked_at')
      .eq('resend_id', resendId)
      .maybeSingle();
    message = again.data;
  } else if (data.message_id) {
    await supabase
      .from('sales_email_messages')
      .update({ message_id: data.message_id, updated_at: new Date().toISOString() })
      .eq('id', message.id);
  }

  // Idempotent event insert
  const recipient = (data.to?.[0] ?? null)?.toLowerCase() ?? null;
  const { error: insertErr } = await supabase.from('sales_email_events').insert({
    message_id: message?.id ?? null,
    resend_id: resendId,
    svix_id: svixId,
    event_type: eventType,
    recipient,
    click_url: data.click?.link ?? null,
    user_agent: data.click?.userAgent ?? null,
    ip_address: data.click?.ipAddress ?? null,
    payload,
    occurred_at: occurredAt,
  });

  if (insertErr) {
    // Unique violation on svix_id → already processed
    if (insertErr.code === '23505') {
      return new Response(JSON.stringify({ ok: true, duplicate: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    console.error('email event insert failed', insertErr);
    return new Response(JSON.stringify({ error: 'Failed to store event' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (message) {
    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = { updated_at: nowIso };

    if (eventType === 'email.opened') {
      patch.open_count = (message.open_count ?? 0) + 1;
      patch.last_opened_at = occurredAt;
      if (!message.first_opened_at) patch.first_opened_at = occurredAt;
    } else if (eventType === 'email.clicked') {
      patch.click_count = (message.click_count ?? 0) + 1;
      patch.last_clicked_at = occurredAt;
      if (!message.first_clicked_at) patch.first_clicked_at = occurredAt;
    } else if (eventType === 'email.delivered') {
      patch.status = 'delivered';
      patch.delivered_at = occurredAt;
    } else if (eventType === 'email.delivery_delayed') {
      patch.status = 'delivery_delayed';
    } else if (eventType === 'email.bounced') {
      patch.status = 'bounced';
      patch.bounced_at = occurredAt;
    } else if (eventType === 'email.complained') {
      patch.status = 'complained';
    } else if (eventType === 'email.failed' || eventType === 'email.suppressed') {
      patch.status = eventType.replace('email.', '');
    } else if (eventType === 'email.sent') {
      patch.status = 'sent';
    }

    if (Object.keys(patch).length > 1) {
      await supabase
        .from('sales_email_messages')
        .update(patch)
        .eq('id', message.id);
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
