/**
 * Apply entity email signature via Microsoft Graph / document NEED_HUMAN.
 *
 * Graph mailboxSettings does not expose Outlook signatures. Exchange Online
 * `Set-MailboxMessageConfiguration` (EXO PowerShell) or roaming-signature
 * tooling is required for org push. This module:
 * 1) resolves the signature HTML for the employee's entity
 * 2) attempts Graph only when an experimental endpoint is enabled
 * 3) otherwise returns NEED_HUMAN with exact admin steps
 */

import {
  renderEmailSignatureFragment,
  type SignaturePerson,
} from '@/lib/brand/email-signatures/render';
import { getMsGraphAppToken } from '@/lib/platform-email/graph-app-token';
import { PARENT_ENTITY_ID } from '@/lib/brand/email-signatures/portfolio';

export type ApplySignatureResult = {
  ok: boolean;
  mode: 'applied' | 'dry_run' | 'need_human' | 'error';
  detail: string;
  html?: string;
  admin_steps?: string[];
};

export function buildSignatureForEmployee(input: {
  fullName: string;
  jobTitle?: string | null;
  email: string;
  phone?: string | null;
  entityId?: string | null;
}): { person: SignaturePerson; html: string } {
  const person: SignaturePerson = {
    fullName: input.fullName.trim() || 'Team Member',
    jobTitle: (input.jobTitle ?? '').trim() || 'Team Member',
    email: input.email.trim(),
    phone: input.phone,
    entityId: input.entityId?.trim() || PARENT_ENTITY_ID,
  };
  return { person, html: renderEmailSignatureFragment(person) };
}

/**
 * Prefer dry-run unless EMAIL_SIGNATURE_APPLY=1.
 * Even when enabled, Graph typically cannot set signatures → NEED_HUMAN.
 */
export async function applyEntityEmailSignature(input: {
  fullName: string;
  jobTitle?: string | null;
  email: string;
  phone?: string | null;
  entityId?: string | null;
  /** Force attempt (still may NEED_HUMAN) */
  forceApply?: boolean;
}): Promise<ApplySignatureResult> {
  const { person, html } = buildSignatureForEmployee(input);
  const applyLive =
    input.forceApply === true ||
    process.env.EMAIL_SIGNATURE_APPLY === '1' ||
    process.env.EMAIL_SIGNATURE_APPLY === 'true';

  if (!applyLive) {
    return {
      ok: true,
      mode: 'dry_run',
      detail: `Dry-run signature for ${person.email} (${person.entityId}). Set EMAIL_SIGNATURE_APPLY=1 after admin confirms EXO path.`,
      html,
      admin_steps: exoAdminSteps(person.email),
    };
  }

  const token = await getMsGraphAppToken();
  if (!token) {
    return {
      ok: false,
      mode: 'need_human',
      detail:
        'NEED_HUMAN: MS_GRAPH_* credentials missing — cannot call Graph. Use Outlook paste or EXO PowerShell.',
      html,
      admin_steps: exoAdminSteps(person.email),
    };
  }

  // Graph has no supported application API for Outlook signatures (2026-08).
  // Probe mailboxSettings only to confirm app can read mailbox; never invent success.
  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIClient(person.email)}/mailboxSettings`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.status === 403 || res.status === 401) {
      return {
        ok: false,
        mode: 'need_human',
        detail: `NEED_HUMAN: Graph mailboxSettings ${res.status} — grant MailboxSettings.ReadWrite (still no signature write API). Use EXO below.`,
        html,
        admin_steps: exoAdminSteps(person.email),
      };
    }
  } catch {
    /* fall through to NEED_HUMAN */
  }

  return {
    ok: false,
    mode: 'need_human',
    detail:
      'NEED_HUMAN: Microsoft Graph does not support setting Outlook email signatures. Use Exchange Online Set-MailboxMessageConfiguration or paste HTML in Outlook.',
    html,
    admin_steps: exoAdminSteps(person.email),
  };
}

function encodeURIClient(email: string): string {
  return encodeURIComponent(email.trim());
}

export function exoAdminSteps(upn: string): string[] {
  const safe = upn.replace(/'/g, "''");
  return [
    'Connect: Connect-ExchangeOnline -UserPrincipalName <admin@tagevc.com>',
    `Set signature HTML: Set-MailboxMessageConfiguration -Identity '${safe}' -SignatureHtml @' ... '@ -AutoAddSignature $true -AutoAddSignatureOnReply $true`,
    'Paste the generated HTML fragment (from Brand Collateral / Email Signatures) into -SignatureHtml.',
    'Outlook desktop (manual): Outlook → Settings → Accounts → Signatures → New → paste HTML from browser preview, or File → Options → Mail → Signatures.',
    'Outlook on the web: Settings → Mail → Compose and reply → Email signature → paste.',
    'Do not apply to break-glass accounts.',
  ];
}
