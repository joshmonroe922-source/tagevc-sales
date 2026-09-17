/**
 * Email Ginger and Ian their Recruit 619 signatures (Dennis layout).
 *
 * Graph cannot push an Outlook signature, so this sends the block inline and
 * attaches the standalone .html for a clean copy from the browser.
 *
 *   node scripts/r619-onboard/send-signatures.mjs           # dry run
 *   node scripts/r619-onboard/send-signatures.mjs --apply   # send
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { graph, env } from '../dennis-onboard/lib.mjs';

const APPLY = process.argv.includes('--apply');
const here = dirname(fileURLToPath(import.meta.url));
const PEOPLE = resolve(here, '../../brand/marketing-sot/email-signatures/people');

const SENDER = env.M365_R619_HOST_MAILBOX || 'joshmonroe@recruit619.com';

const RECIPIENTS = [
  {
    first: 'Ginger',
    fullName: 'Ginger Claremohr',
    slug: 'Ginger-Claremohr',
    to: 'gingerclaremohr@recruit619.com',
  },
  {
    first: 'Ian',
    fullName: 'Ian Hobson',
    slug: 'Ian-Hobson',
    to: 'ianhobson@recruit619.com',
  },
];

function buildHtml(first, fragment, attachmentName) {
  return `
<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a;max-width:660px">
  <p>Hi ${first},</p>

  <p>Here's your Recruit 619 email signature — same layout as Dennis's
  (Recruit 619 first, then Tage VC, Signent HR, and Instant NDA). Each logo
  links to that company's site.</p>

  <p>The phone number is a placeholder: <strong>(619) 555-0100</strong>. After
  you paste the signature into Outlook, replace that number with yours.</p>

  <p><strong>Easiest way to save it:</strong> open the attached
  <em>${attachmentName}</em> in Chrome or Safari, select all
  (&#8984;A), copy (&#8984;C), then paste using the steps below. You can also
  select and copy the block at the bottom of this email directly.</p>

  <h3 style="margin:22px 0 8px;font-size:15px">Outlook for Mac</h3>
  <ol style="margin:0;padding-left:20px">
    <li>Outlook &rarr; Settings &rarr; Signatures</li>
    <li>Click <strong>+</strong> to add one, name it &ldquo;Recruit 619&rdquo;</li>
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

  <p>If anything looks off — title or spelling — reply and I'll regenerate it.</p>

  <p style="margin-top:20px">Josh Monroe<br>
  <span style="color:#666">Recruit 619</span></p>

  <div style="margin:28px 0 10px;border-top:1px solid #ddd"></div>
  <div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#888;padding-bottom:12px">
    Your signature &mdash; copy everything below this line
  </div>
  ${fragment}
</div>`.trim();
}

async function sendOne({ first, fullName, slug, to }) {
  const dir = resolve(PEOPLE, slug);
  const full = readFileSync(resolve(dir, `${slug}.html`), 'utf8');
  const fragment = readFileSync(resolve(dir, `${slug}.fragment.html`), 'utf8');
  const attachmentName = `${fullName} Email Signature.html`;
  const subject = 'Your Recruit 619 email signature — ready to save in Outlook';
  const html = buildHtml(first, fragment, attachmentName);

  const message = {
    subject,
    body: { contentType: 'HTML', content: html },
    toRecipients: [{ emailAddress: { address: to } }],
    attachments: [
      {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: attachmentName,
        contentType: 'text/html',
        contentBytes: Buffer.from(full, 'utf8').toString('base64'),
      },
    ],
  };

  console.log('--- signature email ---');
  console.log('from      :', SENDER);
  console.log('to        :', to);
  console.log('subject   :', subject);
  console.log('attachment:', attachmentName);
  console.log('body chars:', html.length, '· fragment chars:', fragment.length);

  if (!APPLY) {
    console.log('DRY RUN — re-run with --apply to send.\n');
    return { to, sent: false };
  }

  const send = await graph(`v1.0/users/${encodeURIComponent(SENDER)}/sendMail`, {
    method: 'POST',
    body: JSON.stringify({ message, saveToSentItems: true }),
  });

  console.log(`sendMail HTTP ${send.status}`);
  if (!send.ok) {
    console.log(JSON.stringify(send.body, null, 1).slice(0, 800));
    throw new Error(`sendMail failed for ${to}`);
  }
  console.log('Sent.\n');
  return { to, sent: true };
}

for (const person of RECIPIENTS) {
  await sendOne(person);
}

if (!APPLY) {
  console.log('No mail sent.');
}
