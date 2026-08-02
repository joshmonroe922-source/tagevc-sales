/**
 * Locked email model (Josh 2026-08-02) — Tage OS + all subsidiary spines.
 *
 * 1. Individual — send as the user's real M365 mailbox (Graph `/me/sendMail`).
 * 2. System/process — M365 aliases / shared mailboxes (AP, AR, W-9, digests).
 * 3. Bulk/list — controlled platform send; Reply-To = user; log on records.
 *
 * Bootstrap (live): aliases on joshmonroe@tagevc.com — see m365-aliases.ts.
 * Backlog: AI signature contact mining.
 */

import {
  aliasAddressFor,
  M365_BOOTSTRAP_ALIASES,
  M365_HOST_MAILBOX,
  type M365Workflow,
} from '@/lib/platform-email/m365-aliases';

export type EmailChannel = 'individual' | 'system' | 'bulk';

export const EMAIL_MODEL_CONTRACT = 'email-model-v1' as const;

export const EMAIL_CHANNEL_RULES: Record<
  EmailChannel,
  {
    from: 'user_mailbox' | 'shared_mailbox';
    replyTo: 'thread' | 'user' | 'shared';
    tracking: 'pixel_required' | 'pixel_preferred' | 'optional';
    crmLog: boolean;
  }
> = {
  individual: {
    from: 'user_mailbox',
    replyTo: 'thread',
    tracking: 'pixel_preferred',
    crmLog: true,
  },
  system: {
    from: 'shared_mailbox',
    replyTo: 'shared',
    tracking: 'optional',
    crmLog: true,
  },
  bulk: {
    from: 'user_mailbox',
    replyTo: 'user',
    tracking: 'pixel_required',
    crmLog: true,
  },
};

/** @deprecated Prefer M365Workflow via m365-aliases — kept for send() sharedRole. */
export type SharedMailboxRole =
  | 'ap_invoices'
  | 'ar_invoices'
  | 'w9'
  | 'system_noreply';

const ROLE_TO_WORKFLOW: Record<SharedMailboxRole, M365Workflow> = {
  ap_invoices: 'ap',
  ar_invoices: 'ar',
  w9: 'w9',
  system_noreply: 'system',
};

/** Resolve From address for system sends (bootstrap aliases on Tage VC). */
export function resolveSharedMailboxUpn(
  _entityId: string,
  role: SharedMailboxRole,
): string {
  const envKey = `M365_SHARED_${role.toUpperCase()}`;
  const override = process.env[envKey]?.trim();
  if (override) return override;
  return aliasAddressFor(ROLE_TO_WORKFLOW[role]);
}

/** Host mailbox that owns bootstrap aliases (send-as + inbound). */
export function resolveSystemHostMailbox(): string {
  return M365_HOST_MAILBOX;
}

export const SHARED_M365_MAILBOXES = M365_BOOTSTRAP_ALIASES.map((a) => ({
  entityId: 'ENT-FIRM' as const,
  role: a.workflow,
  upn: a.address,
  hostMailbox: M365_HOST_MAILBOX,
  aliases: a.acceptLocalParts,
  description: a.description,
}));

export const EMAIL_ANALYTICS_APPROACH = {
  individual_bulk:
    'Graph send + OS pixel/click wrapper (/api/platform-email/mail-tracking) → os_platform_email_*',
  system:
    'Graph send-as from host mailbox with From=alias; inbound poller routes by To: → AP/AR/W-9 queues',
  tradeoff:
    'Graph alone has no reliable open tracking — hybrid pixel on Graph HTML for opens/clicks',
  backlog: 'AI signature contact extraction → CRM (not in this pass)',
} as const;
