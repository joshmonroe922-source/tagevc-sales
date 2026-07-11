// Resend email helper — set RESEND_API_KEY + RESEND_FROM_EMAIL in Supabase secrets

export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}

export async function sendResendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from =
    Deno.env.get('RESEND_FROM_EMAIL') ??
    'Tage Venture Capital <noreply@tagevc.com>';

  if (!apiKey) {
    console.warn('RESEND_API_KEY not set — skipping email');
    return { ok: false, error: 'RESEND_API_KEY not configured' };
  }

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
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('Resend error:', text);
    return { ok: false, error: text };
  }
  return { ok: true };
}

/** @deprecated alias */
export const sendEmail = sendResendEmail;
