/**
 * Live M365 bootstrap aliases (Josh 2026-08-02).
 *
 * Host mailbox: joshmonroe@tagevc.com (send-from-aliases enabled).
 * All three land in Josh’s inbox for now — route by To: into OS queues.
 * Later: shared mailboxes / per-entity aliases when volume grows.
 */

export const M365_HOST_MAILBOX =
  process.env.M365_HOST_MAILBOX?.trim() || 'joshmonroe@tagevc.com';

export type M365Workflow = 'ap' | 'ar' | 'w9' | 'system';

export type M365AliasBinding = {
  workflow: M365Workflow;
  /** Canonical SMTP address used for From / To matching */
  address: string;
  /** Alternate local-parts we accept on inbound */
  acceptLocalParts: string[];
  description: string;
};

/**
 * Bootstrap addresses on tagevc.com.
 * Confirm exact W-9 spelling in M365 admin — we accept w-9@ and w9@.
 */
export const M365_BOOTSTRAP_ALIASES: M365AliasBinding[] = [
  {
    workflow: 'ap',
    address:
      process.env.M365_ALIAS_AP?.trim() || 'accountspayable@tagevc.com',
    acceptLocalParts: ['accountspayable', 'ap', 'ap+tvc'],
    description: 'Accounts Payable — vendor invoices → AP portal',
  },
  {
    workflow: 'ar',
    address:
      process.env.M365_ALIAS_AR?.trim() || 'accountsreceivable@tagevc.com',
    acceptLocalParts: ['accountsreceivable', 'ar', 'invoices'],
    description: 'Accounts Receivable — customer invoices / remittance',
  },
  {
    workflow: 'w9',
    address: process.env.M365_ALIAS_W9?.trim() || 'w-9@tagevc.com',
    acceptLocalParts: ['w-9', 'w9', 'w_9'],
    description: 'W-9 requests + vendor tax form replies',
  },
];

export function aliasAddressFor(workflow: M365Workflow): string {
  if (workflow === 'system') {
    return (
      process.env.M365_ALIAS_SYSTEM?.trim() ||
      process.env.DIGEST_FROM_EMAIL?.trim() ||
      'noreply@tagevc.com'
    );
  }
  const hit = M365_BOOTSTRAP_ALIASES.find((a) => a.workflow === workflow);
  return hit?.address ?? M365_HOST_MAILBOX;
}

/** Map inbound To: / Cc: address → workflow (null if unknown). */
export function resolveWorkflowFromAddress(
  toAddress: string,
): M365Workflow | null {
  const raw = toAddress.trim().toLowerCase();
  const local = raw.split('@')[0]?.replace(/^"+|"+$/g, '') ?? '';
  const domain = raw.split('@')[1] ?? '';

  // Only route tagevc.com bootstrap aliases for now
  if (domain && !domain.endsWith('tagevc.com')) {
    // Still allow exact full-address env overrides on other domains later
  }

  for (const a of M365_BOOTSTRAP_ALIASES) {
    if (raw === a.address.toLowerCase()) return a.workflow;
    if (a.acceptLocalParts.includes(local)) return a.workflow;
  }
  return null;
}

export type InboundRoute = {
  workflow: M365Workflow;
  address: string;
  hostMailbox: string;
  queueHint: string;
};

export function routeInboundMessage(input: {
  toAddresses: string[];
  ccAddresses?: string[];
}): InboundRoute | null {
  const all = [...input.toAddresses, ...(input.ccAddresses ?? [])];
  for (const addr of all) {
    const wf = resolveWorkflowFromAddress(addr);
    if (!wf) continue;
    const binding = M365_BOOTSTRAP_ALIASES.find((a) => a.workflow === wf);
    return {
      workflow: wf,
      address: binding?.address ?? addr,
      hostMailbox: M365_HOST_MAILBOX,
      queueHint:
        wf === 'ap'
          ? 'os_af_inbound_invoices'
          : wf === 'w9'
            ? 'os_af_vendor_w9'
            : wf === 'ar'
              ? 'os_af_ar_inbox'
              : 'system',
    };
  }
  return null;
}

export const M365_ALIAS_JOSH_NOTES = {
  worksForBootstrap: true,
  caveat:
    'All aliases deliver into joshmonroe@tagevc.com inbox — fine now; shared mailboxes later',
  stillNeed: [
    'Confirm exact W-9 SMTP (w-9@tagevc.com vs w9@tagevc.com) in M365 admin',
    'Azure app Mail.Send + Mail.Read (+ admin consent); send-as on aliases',
    'Graph subscription or poller on host mailbox filtering by To:',
    'Per-entity aliases later (R619, Signent, Instant NDA)',
  ],
} as const;
