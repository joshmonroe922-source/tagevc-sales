/**
 * Joiner invite: email the new hire's *personal* address with their Microsoft
 * sign-in details so they can get into the account themselves on day one.
 *
 * Before this existed the joiner only minted the account and left the temp
 * password for a Visionary to hand over out-of-band, which stalled every hire
 * until someone remembered to do it.
 *
 * Fail-soft by design — a bad/missing personal email must never fail the joiner.
 */

import { entityDisplayName } from '@/lib/entities/display-name';
import { buildInstantNdaAccessCopy } from '@/lib/hris/instant-nda-access';
import { entityOsLabel, entityOsUrl } from '@/lib/multi-sub/entity-registry';
import { platformEmailAppUrl } from '@/lib/platform-email/config';
import { sendPlatformEmail } from '@/lib/platform-email/send';

/** Microsoft self-service password reset entry point. */
const MS_PASSWORD_RESET_URL = 'https://passwordreset.microsoftonline.com';
const MS_SIGN_IN_URL = 'https://www.office.com';

export type JoinerInviteResult = {
  sent: boolean;
  /** Safe for audit/evidence — never contains the password. */
  detail: string;
};

export type JoinerInviteInput = {
  full_name: string;
  /** Where the invite goes. Work mail is unreachable before first sign-in. */
  personal_email: string | null | undefined;
  entity_id: string | null | undefined;
  role_title?: string | null;
  start_date?: string | null;
  /** Microsoft sign-in name (UPN). */
  upn: string;
  /**
   * Temporary password, when the joiner just created the account. Omit for
   * existing accounts and the mail falls back to the password-reset flow.
   */
  temp_password?: string | null;
  /**
   * Override the system From address. Defaults to the entity's no-reply alias;
   * set this when the alias is not yet a send-as-capable mailbox.
   */
  from_address?: string | null;
};

/** Invite mail is on unless explicitly disabled. */
export function joinerInviteEnabled(): boolean {
  const raw = (process.env.HRIS_JOINER_INVITE_EMAIL ?? '1').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || 'there';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function looksLikeEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(value);
}

export function buildJoinerInviteBody(input: JoinerInviteInput): {
  subject: string;
  html: string;
  text: string;
} {
  const company = entityDisplayName(input.entity_id ?? null, 'Tage');
  // Send the hire to the OS of the entity that hired them, not the Tage parent.
  const osUrl = entityOsUrl(input.entity_id, {
    preferDesk: true,
    appUrlFallback: platformEmailAppUrl(),
  });
  const osLabel = entityOsLabel(input.entity_id);
  const hasTemp = Boolean(input.temp_password?.trim());
  const upn = input.upn.trim();

  const subject = `Your ${company} Microsoft account is ready — first sign-in details`;

  const credentialLines = hasTemp
    ? [
        `Sign-in name: ${upn}`,
        `Temporary password: ${input.temp_password!.trim()}`,
        'You will be asked to set your own password the first time you sign in.',
      ]
    : [
        `Sign-in name: ${upn}`,
        `Set your password here before you start: ${MS_PASSWORD_RESET_URL}`,
      ];

  const steps = [
    `Go to ${MS_SIGN_IN_URL} and choose "Sign in".`,
    `Enter ${upn}${hasTemp ? ' and the temporary password above' : ' and the password you just set'}.`,
    ...(hasTemp ? ['Choose a new password when prompted.'] : []),
    'Finish multi-factor authentication setup — the Microsoft Authenticator app is easiest.',
    'Open Outlook and Teams to confirm your mailbox is live.',
    `Sign in to ${osLabel} at ${osUrl} using "Continue with Microsoft" and the same account.`,
  ];

  const nda = buildInstantNdaAccessCopy({
    entity_id: input.entity_id,
    upn,
  });

  const text = [
    `Hi ${firstName(input.full_name)},`,
    '',
    `Welcome to ${company}${input.role_title ? ` as ${input.role_title}` : ''}. Your Microsoft work account is ready.`,
    '',
    ...credentialLines,
    '',
    'First sign-in:',
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    `${nda.heading}:`,
    ...nda.lines,
    '',
    'Reply to this email if anything does not work and we will sort it out before your first day.',
    '',
    `— ${company}`,
  ].join('\n');

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1c1c1c">
  <p>Hi ${escapeHtml(firstName(input.full_name))},</p>
  <p>Welcome to ${escapeHtml(company)}${input.role_title ? ` as ${escapeHtml(input.role_title)}` : ''}. Your Microsoft work account is ready.</p>
  <table style="border-collapse:collapse;margin:18px 0;background:#f6f5f2;border-radius:8px">
    <tbody>
      ${credentialLines
        .map(
          (line) =>
            `<tr><td style="padding:8px 14px;font-size:14px">${escapeHtml(line)}</td></tr>`,
        )
        .join('')}
    </tbody>
  </table>
  <p style="font-weight:600;margin-bottom:6px">First sign-in</p>
  <ol style="margin-top:0;padding-left:20px">
    ${steps.map((s) => `<li style="margin-bottom:6px">${escapeHtml(s)}</li>`).join('')}
  </ol>
  <p style="font-weight:600;margin:18px 0 6px">${escapeHtml(nda.heading)}</p>
  ${nda.lines.map((line) => `<p style="margin:0 0 10px">${escapeHtml(line)}</p>`).join('')}
  <p>Reply to this email if anything does not work and we will sort it out before your first day.</p>
  <p style="color:#6b6b6b">— ${escapeHtml(company)}</p>
</div>`.trim();

  return { subject, html, text };
}

/**
 * Send the invite to the hire's personal address.
 * Never throws; returns a redacted detail string suitable for step evidence.
 */
export async function sendJoinerInvite(
  input: JoinerInviteInput,
): Promise<JoinerInviteResult> {
  if (!joinerInviteEnabled()) {
    return { sent: false, detail: 'Joiner invite email disabled (HRIS_JOINER_INVITE_EMAIL)' };
  }

  const to = input.personal_email?.trim().toLowerCase() ?? '';
  if (!to) {
    return {
      sent: false,
      detail: 'No personal email on file — invite not sent, hand over sign-in details manually',
    };
  }
  if (!looksLikeEmail(to)) {
    return { sent: false, detail: 'Personal email on file is not a valid address — invite not sent' };
  }
  if (!input.upn.trim()) {
    return { sent: false, detail: 'No UPN resolved — invite not sent' };
  }

  const { subject, html, text } = buildJoinerInviteBody(input);

  try {
    const res = await sendPlatformEmail({
      channel: 'system',
      entityId: input.entity_id ?? '',
      to: [to],
      subject,
      bodyHtml: html,
      bodyText: text,
      source: 'system',
      ...(input.from_address?.trim() ? { fromAddress: input.from_address.trim() } : {}),
      // Credentials must not be pixel-tracked or logged into CRM history.
      track: false,
      activityModule: 'shared_services',
      tags: { kind: 'hris_joiner_invite', upn: input.upn.trim() },
    });
    if (!res.ok) {
      return { sent: false, detail: `Joiner invite send failed: ${res.error}` };
    }
    return {
      sent: true,
      detail: `Sign-in invite emailed to personal address (${maskEmail(to)}) via ${res.provider}`,
    };
  } catch (e) {
    return {
      sent: false,
      detail: `Joiner invite send failed: ${e instanceof Error ? e.message : 'unknown error'}`,
    };
  }
}

/** j***@gmail.com — enough to confirm the right address without storing it in evidence. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const head = local.slice(0, 1);
  return `${head}${'*'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
}
