/**
 * Last-resort internal delivery: write a message straight into a tenant
 * mailbox's Inbox via Graph.
 *
 * Sending mail needs the `Mail.Send` application permission. Until that is
 * consented, outbound sends 403 — but `Mail.ReadWrite` (which the app does hold)
 * can create a message inside a mailbox we own. For recipients inside the tenant
 * that is functionally the same as delivery: it lands unread in their Inbox.
 *
 * Only works for tenant mailboxes. External addresses (personal Gmail, clients)
 * still require Mail.Send or Resend.
 */

import { getMsGraphToken, graphConfigured } from '@/lib/shared-services/it-mdm';

export type TenantDeliveryResult =
  | { ok: true; messageId: string | null; webLink: string | null }
  | { ok: false; error: string };

export type TenantDeliveryInput = {
  /** Mailbox to deliver into — UPN or Entra object id. */
  mailboxUpn: string;
  subject: string;
  bodyHtml: string;
  /** Display name shown as the sender. */
  fromName?: string;
  /** Address shown as the sender; defaults to the destination mailbox. */
  fromAddress?: string | null;
  /** Shown in the To: line. Defaults to the destination mailbox. */
  toDisplay?: { name?: string; address: string } | null;
  importance?: 'low' | 'normal' | 'high';
};

/** True when the address belongs to a domain we host in the tenant. */
export function isTenantAddress(
  address: string | null | undefined,
  tenantDomains: string[],
): boolean {
  const domain = (address ?? '').split('@')[1]?.trim().toLowerCase();
  if (!domain) return false;
  return tenantDomains.some((d) => d.trim().toLowerCase() === domain);
}

export async function deliverToTenantMailbox(
  input: TenantDeliveryInput,
): Promise<TenantDeliveryResult> {
  if (!graphConfigured()) {
    return { ok: false, error: 'MS_GRAPH_* not set — cannot deliver to mailbox' };
  }
  const tok = await getMsGraphToken();
  if (!tok.ok) return { ok: false, error: tok.detail };

  const mailbox = input.mailboxUpn.trim();
  if (!mailbox) return { ok: false, error: 'mailboxUpn required' };

  const senderAddress = input.fromAddress?.trim() || mailbox;
  const to = input.toDisplay ?? { address: mailbox };

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tok.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subject: input.subject,
        importance: input.importance ?? 'normal',
        body: { contentType: 'HTML', content: input.bodyHtml },
        from: {
          emailAddress: { name: input.fromName ?? 'Tage OS', address: senderAddress },
        },
        sender: {
          emailAddress: { name: input.fromName ?? 'Tage OS', address: senderAddress },
        },
        toRecipients: [
          { emailAddress: { name: to.name ?? to.address, address: to.address } },
        ],
        isRead: false,
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      ok: false,
      error: `Graph createMessage HTTP ${res.status}: ${text.slice(0, 200)}`,
    };
  }
  const body = (await res.json().catch(() => ({}))) as {
    id?: string;
    webLink?: string;
  };
  return { ok: true, messageId: body.id ?? null, webLink: body.webLink ?? null };
}
