// Resend email helper — set RESEND_API_KEY + RESEND_FROM_EMAIL in Supabase secrets

export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}

export type ResendTag = { name: string; value: string };

export type SendResendResult = {
  ok: boolean;
  error?: string;
  /** Resend email id (for webhooks / analytics). */
  id?: string;
};

/** Sanitize tag values for Resend (ASCII letters, digits, _ , - only). */
export function sanitizeTagValue(value: string, max = 256): string {
  return value
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, max);
}

export function tagsFromRecord(
  record: Record<string, string | undefined | null>,
): ResendTag[] {
  const tags: ResendTag[] = [];
  for (const [name, raw] of Object.entries(record)) {
    if (raw == null || raw === '') continue;
    const safeName = sanitizeTagValue(name, 256);
    const safeValue = sanitizeTagValue(String(raw), 256);
    if (!safeName || !safeValue) continue;
    tags.push({ name: safeName, value: safeValue });
  }
  return tags;
}

export async function sendResendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  tags?: ResendTag[] | Record<string, string | undefined | null>;
}): Promise<SendResendResult> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from =
    Deno.env.get('RESEND_FROM_EMAIL') ??
    'Tage Venture Capital <hello@tagevc.com>';

  if (!apiKey) {
    console.warn('RESEND_API_KEY not set — skipping email');
    return { ok: false, error: 'RESEND_API_KEY not configured' };
  }

  const tags = Array.isArray(opts.tags)
    ? opts.tags
    : opts.tags
      ? tagsFromRecord(opts.tags)
      : undefined;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(opts.to) ? opts.to : [opts.to],
      subject: opts.subject,
      html: opts.html,
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      ...(tags && tags.length ? { tags } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('Resend error:', text);
    return { ok: false, error: text };
  }

  let id: string | undefined;
  try {
    const json = (await res.json()) as { id?: string };
    id = json.id;
  } catch {
    /* response body optional */
  }

  return { ok: true, id };
}

/** @deprecated alias */
export const sendEmail = sendResendEmail;
