/**
 * Outlook-safe HTML email signature renderer (table + inline styles).
 * Same layout system for all entities; entity-specific colors/logos/URLs.
 */

import { entityDisplayName, normalizeEntityId } from '@/lib/entities/display-name';
import { SIGNENT_FAMILY_COLORS } from '@/lib/entities/logo';
import { getEntityBrandPresence } from '@/lib/shared-services/entity-brand-presence';
import {
  PARENT_ENTITY_ID,
  signatureLogoBar,
  type SignatureLogoLink,
} from '@/lib/brand/email-signatures/portfolio';

export type SignaturePerson = {
  fullName: string;
  jobTitle: string;
  email: string;
  phone?: string | null;
  /** Employer entity — drives primary logo order + company line */
  entityId: string;
  /** Optional override for company display line */
  companyLine?: string;
};

const GOLD = SIGNENT_FAMILY_COLORS.gold;
const NAVY = SIGNENT_FAMILY_COLORS.navy;

/** Display height for logo bar marks (px). Width scales with aspect. */
const LOGO_H = 28;
const LOGO_MAX_W = 92;

export function renderEmailSignatureHtml(person: SignaturePerson): string {
  const entityId = normalizeEntityId(person.entityId) || PARENT_ENTITY_ID;
  const company =
    person.companyLine?.trim() ||
    shortCompanyLine(entityId);
  const website = getEntityBrandPresence(entityId)?.website_url?.trim() || '';
  const logos = signatureLogoBar(entityId).filter((l) => l.logoUrl);
  const phone = (person.phone ?? '').trim();

  const logoCells = logos
    .map((l, i) => logoCell(l, i < logos.length - 1))
    .join('');

  const contactBits: string[] = [];
  contactBits.push(
    `<a href="mailto:${escapeAttr(person.email)}" style="color:${NAVY};text-decoration:none;">${escapeHtml(person.email)}</a>`,
  );
  if (website) {
    contactBits.push(
      `<a href="${escapeAttr(website)}" style="color:${GOLD};text-decoration:none;" target="_blank">${escapeHtml(displayHost(website))}</a>`,
    );
  }
  if (phone) {
    contactBits.push(
      `<a href="tel:${escapeAttr(phone.replace(/[^\d+]/g, ''))}" style="color:${NAVY};text-decoration:none;">${escapeHtml(phone)}</a>`,
    );
  }

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(person.fullName)} — Email Signature</title></head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Calibri,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.35;color:${NAVY};">
  <tr>
    <td style="padding:0 0 10px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td style="padding:0 14px 0 0;border-right:3px solid ${GOLD};vertical-align:top;">
            <div style="font-size:16px;font-weight:700;color:${NAVY};letter-spacing:0.01em;">${escapeHtml(person.fullName)}</div>
            <div style="font-size:13px;color:${NAVY};opacity:0.92;padding-top:2px;">${escapeHtml(person.jobTitle)}</div>
            <div style="font-size:13px;font-weight:600;color:${GOLD};padding-top:2px;">${escapeHtml(company)}</div>
            <div style="font-size:12px;padding-top:8px;line-height:1.55;">${contactBits.join('<br>')}</div>
          </td>
          <td style="padding:0 0 0 14px;vertical-align:middle;">
            ${primaryLogoBlock(logos.find((l) => l.primary) ?? logos[0])}
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding:10px 0 0 0;border-top:1px solid #D9D4C8;">
      <div style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:${GOLD};padding-bottom:6px;font-weight:600;">Our companies</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
        <tr>
          ${logoCells}
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Fragment-only body (for Outlook “Insert → signature” paste without DOCTYPE). */
export function renderEmailSignatureFragment(person: SignaturePerson): string {
  const full = renderEmailSignatureHtml(person);
  const m = full.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return (m?.[1] ?? full).trim();
}

function primaryLogoBlock(logo: SignatureLogoLink | undefined): string {
  if (!logo?.logoUrl) return '';
  return `<a href="${escapeAttr(logo.href)}" target="_blank" style="text-decoration:none;">
  <img src="${escapeAttr(logo.logoUrl)}" alt="${escapeAttr(logo.label)}" width="140" height="61" style="display:block;border:0;outline:none;width:140px;height:auto;max-height:61px;" />
</a>`;
}

function logoCell(logo: SignatureLogoLink, withPad: boolean): string {
  const pad = withPad ? 'padding-right:14px;' : '';
  return `<td style="${pad}vertical-align:middle;">
  <a href="${escapeAttr(logo.href)}" target="_blank" title="${escapeAttr(logo.label)}" style="text-decoration:none;">
    <img src="${escapeAttr(logo.logoUrl)}" alt="${escapeAttr(logo.label)}" height="${LOGO_H}" style="display:block;border:0;outline:none;height:${LOGO_H}px;width:auto;max-width:${LOGO_MAX_W}px;" />
  </a>
</td>`;
}

function shortCompanyLine(entityId: string): string {
  if (entityId === 'ENT-FIRM') return 'Tage VC';
  return entityDisplayName(entityId);
}

function displayHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '');
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

/** Known people for quick export (not a directory SoR). */
export const KNOWN_SIGNATURE_PEOPLE: SignaturePerson[] = [
  {
    fullName: 'Josh Monroe',
    jobTitle: 'Founder / CEO',
    email: 'joshmonroe@tagevc.com',
    entityId: 'ENT-FIRM',
    companyLine: 'Tage VC',
  },
  {
    fullName: 'Lauren Monroe',
    // Entra UPN/mail (2026-08). HRIS alias lauren@tagevc.com is not a mailbox.
    jobTitle: 'Principal Strategist',
    email: 'laurenmonroe@tagevc.com',
    entityId: 'ENT-FIRM',
    companyLine: 'Tage VC',
  },
];
