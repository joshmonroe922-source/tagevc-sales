#!/usr/bin/env node
/**
 * Standalone export — no @/ path aliases. Ships Josh's signature first.
 */
const fs = require('fs');
const path = require('path');

const GOLD = '#B2A384';
const NAVY = '#3B4559';
const BASE =
  'https://opdqybaatfbwkokbzwli.supabase.co/storage/v1/object/public/brand-assets/marketing-sot';

const PORTFOLIO = [
  {
    id: 'ENT-FIRM',
    label: 'Tage VC',
    href: 'https://tagevc.com',
    logo: `${BASE}/ENT-FIRM/tagevc-logo-gold-blue-on-white-rectangle.png`,
  },
  {
    id: 'ENT-R619',
    label: 'Recruit 619',
    href: 'https://recruit619.com',
    logo: `${BASE}/ENT-R619/recruit619-logo-gold-on-white-rectangle.png`,
  },
  {
    id: 'ENT-SIGNENT',
    label: 'Signent HR',
    href: 'https://signenthr.com',
    logo: `${BASE}/ENT-SIGNENT/signent-hr-logo-gold-on-white-rectangle.png`,
  },
  {
    id: 'ENT-INDA',
    label: 'Instant NDA',
    href: 'https://instantnda.us',
    logo: `${BASE}/ENT-INDA/instantnda-logo-horizontal.png`,
  },
];

function logoBarHtml(orderIds) {
  const logos = orderIds.map((id) => PORTFOLIO.find((p) => p.id === id)).filter(Boolean);
  return logos
    .map((l, i) => {
      const pad = i < logos.length - 1 ? 'padding-right:14px;' : '';
      return `<td style="${pad}vertical-align:middle;"><a href="${l.href}" target="_blank" title="${l.label}" style="text-decoration:none;"><img src="${l.logo}" alt="${l.label}" height="28" style="display:block;border:0;height:28px;width:auto;max-width:92px;" /></a></td>`;
    })
    .join('');
}

function orderedBar(primaryId) {
  if (primaryId === 'ENT-FIRM') return PORTFOLIO.map((p) => p.id);
  return [
    primaryId,
    'ENT-FIRM',
    ...PORTFOLIO.map((p) => p.id).filter((id) => id !== primaryId && id !== 'ENT-FIRM'),
  ];
}

function render({ fullName, jobTitle, email, companyLine, entityId, phone }) {
  const primary = PORTFOLIO.find((p) => p.id === entityId) || PORTFOLIO[0];
  const contact = [
    `<a href="mailto:${email}" style="color:${NAVY};text-decoration:none;">${email}</a>`,
    `<a href="${primary.href}" style="color:${GOLD};text-decoration:none;" target="_blank">${primary.href.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>`,
  ];
  if (phone) {
    contact.push(
      `<a href="tel:${phone.replace(/[^\\d+]/g, '')}" style="color:${NAVY};text-decoration:none;">${phone}</a>`,
    );
  }
  const body = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Calibri,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.35;color:${NAVY};">
  <tr>
    <td style="padding:0 0 10px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td style="padding:0 14px 0 0;border-right:3px solid ${GOLD};vertical-align:top;">
            <div style="font-size:16px;font-weight:700;color:${NAVY};">${fullName}</div>
            <div style="font-size:13px;color:${NAVY};opacity:0.92;padding-top:2px;">${jobTitle}</div>
            <div style="font-size:13px;font-weight:600;color:${GOLD};padding-top:2px;">${companyLine}</div>
            <div style="font-size:12px;padding-top:8px;line-height:1.55;">${contact.join('<br>')}</div>
          </td>
          <td style="padding:0 0 0 14px;vertical-align:middle;">
            <a href="${primary.href}" target="_blank" style="text-decoration:none;">
              <img src="${primary.logo}" alt="${primary.label}" width="140" style="display:block;border:0;width:140px;height:auto;max-height:61px;" />
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding:10px 0 0 0;border-top:1px solid #D9D4C8;">
      <div style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:${GOLD};padding-bottom:6px;font-weight:600;">Our companies</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
        <tr>${logoBarHtml(orderedBar(entityId))}</tr>
      </table>
    </td>
  </tr>
</table>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${fullName} — Email Signature</title></head>
<body style="margin:0;padding:16px;background:#ffffff;">${body}</body></html>`;
}

function writeAll(dir, slug, html) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${slug}.html`), html);
  const frag = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  fs.writeFileSync(
    path.join(dir, `${slug}.fragment.html`),
    (frag ? frag[1] : html).trim(),
  );
}

const HOME = process.env.HOME || '/Users/joshmonroe';
const DL = path.join(HOME, 'Downloads/Brand Collateral/Email Signatures');
const REPO = path.join(__dirname, '../..');
const SOT = path.join(REPO, 'brand/marketing-sot/email-signatures');

const people = [
  {
    fullName: 'Josh Monroe',
    jobTitle: 'Founder / CEO',
    email: 'joshmonroe@tagevc.com',
    companyLine: 'Tage VC',
    entityId: 'ENT-FIRM',
  },
  {
    fullName: 'Lauren Monroe',
    jobTitle: 'Principal Strategist',
    email: 'laurenmonroe@tagevc.com',
    companyLine: 'Tage VC',
    entityId: 'ENT-FIRM',
  },
];

for (const person of people) {
  const html = render(person);
  const slug = person.fullName.replace(/\s+/g, '-');
  writeAll(path.join(DL, person.fullName), slug, html);
  writeAll(path.join(SOT, 'people', slug), slug, html);
  fs.writeFileSync(
    path.join(HOME, 'Downloads', `${person.fullName} Email Signature.html`),
    html,
  );
  fs.writeFileSync(
    path.join(DL, `${person.fullName} Email Signature.html`),
    html,
  );
}

const entities = {
  'ENT-FIRM': { companyLine: 'Tage VC', email: 'hello@tagevc.com' },
  'ENT-R619': { companyLine: 'Recruit 619', email: 'hello@recruit619.com' },
  'ENT-SIGNENT': { companyLine: 'Signent HR', email: 'hello@signenthr.com' },
  'ENT-INDA': { companyLine: 'Instant NDA', email: 'hello@instantnda.us' },
};

for (const [id, meta] of Object.entries(entities)) {
  const html = render({
    fullName: '{{Full Name}}',
    jobTitle: '{{Job Title}}',
    email: meta.email,
    companyLine: meta.companyLine,
    entityId: id,
  });
  writeAll(path.join(DL, 'templates', id), id, html);
  writeAll(path.join(SOT, 'templates', id), id, html);
}

const readme = `# Email Signatures

## Ready now

- **Josh Monroe** (Founder / CEO) — \`joshmonroe@tagevc.com\` / ENT-FIRM
- **Lauren Monroe** (Principal Strategist) — \`laurenmonroe@tagevc.com\` / ENT-FIRM

1. Open \`{Name} Email Signature.html\` in Chrome/Safari (double-click).
2. Select all (⌘A) → Copy (⌘C).
3. Outlook Mac: Outlook → Settings → Email → Signatures → New → paste → assign to new + replies.
4. Outlook on the web: Settings → Mail → Compose and reply → Email signature → paste → Save.
5. Outlook Windows: File → Options → Mail → Signatures.

Logo bar: Tage VC · Recruit 619 · Signent HR · Instant NDA — each logo links to that company site.

Graph cannot push Outlook signatures — paste today or use EXO Set-MailboxMessageConfiguration (see docs/EMAIL_SIGNATURES.md).
`;
fs.writeFileSync(path.join(DL, 'README.md'), readme);
fs.writeFileSync(path.join(SOT, 'README.md'), readme);

console.log('OK people →', people.map((p) => p.fullName).join(', '));
console.log('OK Downloads root:', path.join(HOME, 'Downloads'));
console.log('OK folder →', DL);
