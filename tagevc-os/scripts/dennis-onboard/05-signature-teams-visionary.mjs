/**
 * Day-one collateral + Visionary access for Dennis.
 *
 *  A. Attempt the Visionary FullAccess mailbox grant and record the real result.
 *  B. Render his ENT-R619 email signature from the marketing SoT template.
 *  C. Confirm the ENT-R619 Teams background is published on the brand CDN.
 *  D. Drop a welcome message straight into his Inbox carrying both, so the
 *     signature and background are in his hands the moment he signs in.
 *
 * Graph has no API for Outlook signatures or Teams backgrounds, and app-only
 * Exchange Online still 403s despite Exchange.ManageAsApp being granted, so
 * delivery into the mailbox is the only live path.
 */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { graph, show, env } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

const DENNIS_ID = '89fdd120-d221-4953-93a2-fc39a5f46983';
const DENNIS_UPN = 'dennismccall@recruit619.com';
const VISIONARY_UPN = 'joshmonroe@tagevc.com';
const FULL_NAME = 'Dennis McCall';
const JOB_TITLE = 'VP of Recruiting';
const CDN = 'https://opdqybaatfbwkokbzwli.supabase.co/storage/v1/object/public/brand-assets/marketing-sot';
const TEAMS_BG = `${CDN}/teams-backgrounds/ENT-R619/ENT-R619-recruit-619-teams-background.png`;

const results = {};

// --- 0. mailbox reachable? --------------------------------------------------
const folders = await graph(`v1.0/users/${DENNIS_ID}/mailFolders?$select=displayName,totalItemCount`);
results.mailbox_http = folders.status;
results.mailbox_folders = (folders.body?.value ?? []).map((f) => f.displayName);
show('mailbox folders', folders);

// --- A. Visionary FullAccess ------------------------------------------------
const visionary = await graph(`beta/users/${DENNIS_ID}/mailboxPermissions`, {
  method: 'POST',
  body: JSON.stringify({
    emailAddress: { address: VISIONARY_UPN },
    accessRights: ['fullAccess'],
    isInherited: false,
  }),
});
show('visionary mailboxPermissions (beta)', visionary);
results.visionary_grant = { http: visionary.status, body: visionary.body };

// --- B. signature -----------------------------------------------------------
const tpl = readFileSync(
  resolve(root, 'brand/marketing-sot/email-signatures/templates/ENT-R619/ENT-R619.fragment.html'),
  'utf8',
);
const fragment = tpl
  .replace(/\{\{Full Name\}\}/g, FULL_NAME)
  .replace(/\{\{Job Title\}\}/g, JOB_TITLE)
  .replace(
    '<a href="mailto:hello@recruit619.com" style="color:#3B4559;text-decoration:none;">hello@recruit619.com</a>',
    `<a href="mailto:${DENNIS_UPN}" style="color:#3B4559;text-decoration:none;">${DENNIS_UPN}</a>`,
  );

const fullDoc = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${FULL_NAME} — Email Signature</title></head>
<body style="margin:0;padding:0;background:#ffffff;">
${fragment}
</body></html>`;

const peopleDir = resolve(root, 'brand/marketing-sot/email-signatures/people/Dennis');
mkdirSync(peopleDir, { recursive: true });
writeFileSync(resolve(peopleDir, 'Dennis.fragment.html'), fragment);
writeFileSync(resolve(peopleDir, 'Dennis.html'), fullDoc);
results.signature_bytes = fullDoc.length;
console.log(`\nsignature written (${fullDoc.length} bytes) to brand/marketing-sot/email-signatures/people/Dennis/`);

// publish signature to the brand CDN so the HRIS step has a real evidence URL
const upload = await fetch(
  `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/brand-assets/marketing-sot/email-signatures/people/Dennis/Dennis.html`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'text/html',
      'x-upsert': 'true',
    },
    body: fullDoc,
  },
);
const signatureUrl = `${CDN}/email-signatures/people/Dennis/Dennis.html`;
results.signature_upload_http = upload.status;
results.signature_url = signatureUrl;
console.log('signature upload HTTP', upload.status, signatureUrl);

// --- C. Teams background ----------------------------------------------------
const bg = await fetch(TEAMS_BG);
results.teams_bg_http = bg.status;
results.teams_bg_url = TEAMS_BG;
let bgBase64 = null;
if (bg.ok) {
  const buf = Buffer.from(await bg.arrayBuffer());
  bgBase64 = buf.toString('base64');
  results.teams_bg_bytes = buf.length;
}
console.log('teams background HTTP', bg.status, results.teams_bg_bytes ?? '');

// --- D. welcome message into his Inbox --------------------------------------
const body = `
<div style="font-family:Calibri,Arial,sans-serif;font-size:15px;color:#3B4559;line-height:1.5;">
  <p style="font-size:20px;font-weight:700;margin:0 0 4px;">Welcome to Recruit 619, ${FULL_NAME}.</p>
  <p style="margin:0 0 18px;color:#B2A384;font-weight:600;">${JOB_TITLE} · Day one: ${new Date().toLocaleDateString('en-US', { dateStyle: 'long' })}</p>

  <p>Your Microsoft 365 account and mailbox are live. Two things to set up in your first few minutes:</p>

  <h3 style="color:#3B4559;margin:22px 0 6px;">1. Your email signature</h3>
  <p style="margin:0 0 8px;">In Outlook go to <b>Settings → Mail → Compose and reply → Email signature</b>, then copy the block below and paste it in. Name it <b>Recruit 619</b> and set it as the default for new messages and replies.</p>
  <div style="border:1px solid #D9D4C8;border-radius:6px;padding:16px;background:#ffffff;margin:10px 0 6px;">
    ${fragment}
  </div>
  <p style="font-size:13px;color:#6b7280;margin:0 0 8px;">Also attached as <b>Dennis-email-signature.htm</b>, and hosted at <a href="${signatureUrl}" style="color:#B2A384;">this link</a>.</p>

  <h3 style="color:#3B4559;margin:22px 0 6px;">2. Your Teams background</h3>
  <p style="margin:0 0 8px;">The branded Recruit 619 background is attached as <b>Recruit619-Teams-Background.png</b>. In Teams, join or start a meeting, choose <b>Effects and avatars → Backgrounds → Add new</b>, and select the file. You can also <a href="${TEAMS_BG}" style="color:#B2A384;">download it here</a>.</p>

  <h3 style="color:#3B4559;margin:22px 0 6px;">3. Tage OS</h3>
  <p style="margin:0 0 8px;">Sign in at <a href="https://app.tagevc.com" style="color:#B2A384;">app.tagevc.com</a> with this Microsoft account. Your access is already provisioned as Subsidiary Leader for Recruit 619.</p>

  <p style="margin-top:24px;">Glad you're here.</p>
</div>`;

const attachments = [
  {
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: 'Dennis-email-signature.htm',
    contentType: 'text/html',
    contentBytes: Buffer.from(fullDoc, 'utf8').toString('base64'),
  },
];
if (bgBase64) {
  attachments.push({
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: 'Recruit619-Teams-Background.png',
    contentType: 'image/png',
    contentBytes: bgBase64,
  });
}

const msg = await graph(`v1.0/users/${DENNIS_ID}/mailFolders/inbox/messages`, {
  method: 'POST',
  body: JSON.stringify({
    subject: 'Welcome to Recruit 619 — your signature, Teams background, and Tage OS access',
    importance: 'high',
    body: { contentType: 'HTML', content: body },
    from: { emailAddress: { name: 'Tage OS', address: DENNIS_UPN } },
    sender: { emailAddress: { name: 'Tage OS', address: DENNIS_UPN } },
    toRecipients: [{ emailAddress: { name: FULL_NAME, address: DENNIS_UPN } }],
    isRead: false,
    attachments,
  }),
});
show('welcome message', { ...msg, body: { id: msg.body?.id, subject: msg.body?.subject, hasAttachments: msg.body?.hasAttachments } });
results.welcome_message = { http: msg.status, id: msg.body?.id ?? null, webLink: msg.body?.webLink ?? null };

console.log('\nRESULTS\n', JSON.stringify(results, null, 2));
writeFileSync(
  resolve(root, '.local-secrets/dennis-day1.result.json'),
  JSON.stringify(results, null, 2),
);
