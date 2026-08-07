/** Build a vCard 3.0 from public shareable fields. */

import type { PublicCardPayload } from './types';

function esc(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export function buildVCard(card: PublicCardPayload): string {
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${esc(card.display_name)}`,
    `N:;${esc(card.display_name)};;;`,
    `ORG:${esc(card.company_name)}`,
  ];
  if (card.title) lines.push(`TITLE:${esc(card.title)}`);
  for (const e of card.emails) {
    const type = /work/i.test(e.label) ? 'WORK' : 'INTERNET';
    lines.push(`EMAIL;TYPE=${type}:${esc(e.value)}`);
  }
  for (const p of card.phones) {
    const type = /mobile|cell/i.test(p.label)
      ? 'CELL'
      : /work/i.test(p.label)
        ? 'WORK'
        : 'VOICE';
    lines.push(`TEL;TYPE=${type}:${esc(p.value)}`);
  }
  if (card.website) lines.push(`URL:${esc(card.website)}`);
  if (card.profile_url) {
    lines.push(`URL;TYPE=Card:${esc(card.profile_url)}`);
  }
  if (card.socials.linkedin) {
    lines.push(`X-SOCIALPROFILE;TYPE=linkedin:${esc(card.socials.linkedin)}`);
  }
  if (card.bio_short) lines.push(`NOTE:${esc(card.bio_short)}`);
  lines.push('END:VCARD');
  return lines.join('\r\n') + '\r\n';
}

export function vcardFilename(displayName: string): string {
  const safe = displayName
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 48);
  return `${safe || 'contact'}.vcf`;
}
