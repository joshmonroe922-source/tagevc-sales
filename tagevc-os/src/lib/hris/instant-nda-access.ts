/**
 * Instant NDA enterprise access copy for new hires.
 *
 * Tage and every subsidiary get free Instant NDA enterprise accounts through
 * their email domain (the Instant NDA enterprise domain allowlist), so this is
 * part of standard onboarding for all entities — not a Tage-only perk.
 *
 * The native apps are not live yet, so everyone is pointed at the web app.
 */

import { entityDisplayName } from '@/lib/entities/display-name';
import { resolveCanonicalEntityId } from '@/lib/multi-sub/entity-registry';

/** Web app — use until the native iOS/Android apps ship. */
export const INSTANT_NDA_APP_URL = 'https://app.instantnda.us';

export type InstantNdaCopyInput = {
  entity_id: string | null | undefined;
  /** Work email / UPN, used to name the domain that grants access. */
  upn?: string | null;
};

export type InstantNdaCopy = {
  heading: string;
  lines: string[];
};

function emailDomain(upn: string | null | undefined): string | null {
  const at = (upn ?? '').split('@')[1]?.trim().toLowerCase();
  return at ? `@${at}` : null;
}

/**
 * Entity-correct Instant NDA section.
 * Instant NDA's own staff get "your own product" framing rather than
 * "a company we give you access to".
 */
export function buildInstantNdaAccessCopy(input: InstantNdaCopyInput): InstantNdaCopy {
  const canon = resolveCanonicalEntityId(input.entity_id);
  const company = entityDisplayName(canon ?? null, 'Tage');
  const domain = emailDomain(input.upn);
  const viaDomain = domain ? ` through your ${domain} email` : ' through your work email';
  const isInstantNda = canon === 'ENT-INDA';

  const opening = isInstantNda
    ? `You have full Instant NDA enterprise access${viaDomain} — the product you are joining.`
    : `${company} includes a free Instant NDA enterprise account${viaDomain}, at no cost to you.`;

  return {
    heading: 'Instant NDA — your enterprise access',
    lines: [
      opening,
      `Sign in at ${INSTANT_NDA_APP_URL} using your work email. The native mobile apps are not live yet, so use the web app for now.`,
      'Please use Instant NDA for any sensitive conversation — candidate, client, partner, or deal related — so the NDA is in place before information is shared.',
    ],
  };
}

/**
 * Standalone Instant NDA access email, for hires who are already onboarded.
 */
export function buildInstantNdaEmail(input: {
  full_name: string;
  entity_id: string | null | undefined;
  upn?: string | null;
}): { subject: string; html: string; text: string } {
  const canon = resolveCanonicalEntityId(input.entity_id);
  const company = entityDisplayName(canon ?? null, 'Tage');
  const copy = buildInstantNdaAccessCopy(input);
  const first = input.full_name.trim().split(/\s+/)[0] || 'there';

  const subject = `Your free Instant NDA enterprise access at ${company}`;

  const text = [
    `Hi ${first},`,
    '',
    ...copy.lines,
    '',
    'Any trouble signing in, just reply here.',
    '',
    `— ${company}`,
  ].join('\n');

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1c1c1c">
  <p>Hi ${escapeHtml(first)},</p>
  <p style="font-weight:600;margin-bottom:6px">${escapeHtml(copy.heading)}</p>
  ${copy.lines
    .map(
      (line) =>
        `<p style="margin:0 0 10px">${linkify(escapeHtml(line))}</p>`,
    )
    .join('')}
  <p style="margin-top:18px">
    <a href="${INSTANT_NDA_APP_URL}"
       style="display:inline-block;background:#1c1c1c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px">
      Open Instant NDA
    </a>
  </p>
  <p>Any trouble signing in, just reply here.</p>
  <p style="color:#6b6b6b">— ${escapeHtml(company)}</p>
</div>`.trim();

  return { subject, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Turn the bare app URL in already-escaped copy into a link. */
function linkify(escaped: string): string {
  return escaped.replace(
    INSTANT_NDA_APP_URL,
    `<a href="${INSTANT_NDA_APP_URL}">${INSTANT_NDA_APP_URL}</a>`,
  );
}
