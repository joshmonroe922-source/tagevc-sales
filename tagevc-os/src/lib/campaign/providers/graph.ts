/**
 * Graph adapter — 1:1 / sequence plane only (ADR-001).
 * Never used for marketing blasts.
 */

import { sendGraphMail, sendGraphMailAsUser } from '@/lib/platform/email/graph-send';

export async function sendGraphOneToOne(input: {
  accessToken: string;
  to: string[];
  subject: string;
  bodyHtml: string;
  replyTo?: string | null;
}) {
  await sendGraphMail({
    accessToken: input.accessToken,
    subject: input.subject,
    bodyHtml: input.bodyHtml,
    to: input.to,
    saveToSentItems: true,
  });
  return { provider: 'graph' as const, ok: true };
}

export async function sendGraphAsUser(input: {
  appToken: string;
  userUpn: string;
  to: string[];
  subject: string;
  bodyHtml: string;
  replyTo?: string | null;
}) {
  await sendGraphMailAsUser({
    accessToken: input.appToken,
    userUpn: input.userUpn,
    subject: input.subject,
    bodyHtml: input.bodyHtml,
    to: input.to,
    saveToSentItems: true,
    replyTo: input.replyTo ?? undefined,
  });
  return { provider: 'graph' as const, ok: true };
}
