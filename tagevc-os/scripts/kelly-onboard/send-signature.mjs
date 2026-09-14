/**
 * Email Kelly his Tage VC signature so he can save it in Outlook.
 *
 * Graph cannot push an Outlook signature (see docs/EMAIL_SIGNATURES.md), so this
 * sends the block inline (select + copy straight from the message) and attaches
 * the standalone .html as a fallback for a clean copy from the browser.
 *
 * Sends as Josh via the Mail.Send application role. Carries no credentials.
 *
 *   node scripts/kelly-onboard/send-signature.mjs           # dry run
 *   node scripts/kelly-onboard/send-signature.mjs --apply   # send
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { graph, env } from '../dennis-onboard/lib.mjs';

const APPLY = process.argv.includes('--apply');
const here = dirname(fileURLToPath(import.meta.url));
const SOT = resolve(
  here,
  '../../brand/marketing-sot/email-signatures/people/Kelly-Hipskind',
);

const full = readFileSync(resolve(SOT, 'Kelly-Hipskind.html'), 'utf8');
const fragment = readFileSync(
  resolve(SOT, 'Kelly-Hipskind.fragment.html'),
  'utf8',
);

const SENDER = env.M365_HOST_MAILBOX || 'joshmonroe@tagevc.com';
const TO = 'kellyhipskind@tagevc.com';
const FIRST = 'Kelly';
const subject = 'Your Tage VC email signature — ready to save in Outlook';

const html = `
<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a;max-width:660px">
  <p>Hi ${FIRST},</p>

  <p>Here's your Tage VC email signature — COO, with your cell and the full
  company logo bar (Tage VC, Recruit 619, Signent HR, Instant NDA). Each logo
  links to that company's site.</p>

  <p><strong>Easiest way to save it:</strong> open the attached
  <em>Kelly Hipskind Email Signature.html</em> in Chrome or Safari, select all
  (&#8984;A), copy (&#8984;C), then paste using the steps below. You can also
  select and copy the block at the bottom of this email directly.</p>

  <h3 style="margin:22px 0 8px;font-size:15px">Outlook for Mac</h3>
  <ol style="margin:0;padding-left:20px">
    <li>Outlook &rarr; Settings &rarr; Signatures</li>
    <li>Click <strong>+</strong> to add one, name it &ldquo;Tage VC&rdquo;</li>
    <li>Paste into the editor</li>
    <li>Set it as the default for <strong>new messages</strong> and <strong>replies/forwards</strong></li>
  </ol>

  <h3 style="margin:22px 0 8px;font-size:15px">Outlook on the web</h3>
  <ol style="margin:0;padding-left:20px">
    <li>Settings (gear) &rarr; Mail &rarr; Compose and reply</li>
    <li>Paste into <strong>Email signature</strong>, then Save</li>
  </ol>

  <h3 style="margin:22px 0 8px;font-size:15px">Outlook for Windows</h3>
  <ol style="margin:0;padding-left:20px">
    <li>File &rarr; Options &rarr; Mail &rarr; Signatures</li>
    <li>New, paste, then set it for new messages and replies</li>
  </ol>

  <p style="margin-top:20px;color:#555;font-size:14px">Two notes: paste as
  formatted/rich text (not plain text) or the logos drop off, and the logos load
  from our brand server, so leave them as links rather than re-saving them.</p>

  <p>If anything looks off — title, cell, spelling — reply and I'll regenerate it.</p>

  <p style="margin-top:20px">Josh Monroe<br>
  <span style="color:#666">Tage Venture Capital</span></p>

  <div style="margin:28px 0 10px;border-top:1px solid #ddd"></div>
  <div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#888;padding-bottom:12px">
    Your signature &mdash; copy everything below this line
  </div>
  ${fragment}
</div>`.trim();

const message = {
  subject,
  body: { contentType: 'HTML', content: html },
  toRecipients: [{ emailAddress: { address: TO } }],
  attachments: [
    {
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: 'Kelly Hipskind Email Signature.html',
      contentType: 'text/html',
      contentBytes: Buffer.from(full, 'utf8').toString('base64'),
    },
  ],
};

console.log('--- signature email ---');
console.log('from      :', SENDER);
console.log('to        :', TO);
console.log('subject   :', subject);
console.log('attachment:', message.attachments[0].name);
console.log('body chars:', html.length, '· fragment chars:', fragment.length);

if (!APPLY) {
  console.log('\nDRY RUN — re-run with --apply to send.');
  process.exit(0);
}

const send = await graph(`v1.0/users/${encodeURIComponent(SENDER)}/sendMail`, {
  method: 'POST',
  body: JSON.stringify({ message, saveToSentItems: true }),
});

console.log(`\nsendMail HTTP ${send.status}`);
if (!send.ok) {
  console.log(JSON.stringify(send.body, null, 1).slice(0, 800));
  process.exit(1);
}
console.log('Sent.');
