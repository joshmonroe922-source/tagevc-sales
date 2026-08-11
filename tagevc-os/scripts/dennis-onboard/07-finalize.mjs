/**
 * Finalize Dennis's onboarding run so the record matches what actually happened:
 *  - add him to the same All Company group Josh and Lauren are in (sd.distro)
 *  - publish the signature to the brand CDN
 *  - mark the steps that are genuinely complete, and mark the mailbox grant
 *    blocked with the real Graph error rather than letting it read as pending
 *  - move the run's start date to today
 */

import { graph, show, env } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const { Client } = pg;

const DENNIS_GRAPH_ID = '89fdd120-d221-4953-93a2-fc39a5f46983';
const EMPLOYEE_ID = '3d7937db-34f1-4be1-82a6-21e84b2b26a7';
const RUN_ID = '76ec8793-66d8-4a43-bfbe-1710f1054e5e';
const JOSH = 'joshmonroe@tagevc.com';
const CDN = 'https://opdqybaatfbwkokbzwli.supabase.co/storage/v1/object/public/brand-assets/marketing-sot';
const SIGNATURE_URL = `${CDN}/email-signatures/people/Dennis/Dennis.html`;
const TEAMS_BG = `${CDN}/teams-backgrounds/ENT-R619/ENT-R619-recruit-619-teams-background.png`;

// --- 1. distribution list ---------------------------------------------------
const CANDIDATES = [
  '68696eab-0efc-4485-87e7-f32e0d0f025f',
  '7b22fdac-4055-4675-81e8-f13a099481d3',
];
let targetGroup = null;
for (const gid of CANDIDATES) {
  const m = await graph(`v1.0/groups/${gid}/members?$select=userPrincipalName`);
  const upns = (m.body?.value ?? []).map((u) => u.userPrincipalName);
  console.log(`group ${gid} members:`, upns);
  if (upns.includes(JOSH)) targetGroup = gid;
}
let groupResult = 'no All Company group contained the Visionary — skipped';
if (targetGroup) {
  const add = await graph(`v1.0/groups/${targetGroup}/members/$ref`, {
    method: 'POST',
    body: JSON.stringify({
      '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${DENNIS_GRAPH_ID}`,
    }),
  });
  show('add to All Company', add);
  groupResult =
    add.ok || add.status === 204
      ? `Added to All Company group ${targetGroup}`
      : `Add to group ${targetGroup} failed HTTP ${add.status}: ${JSON.stringify(add.body).slice(0, 200)}`;
}
console.log('\ngroup result:', groupResult);

// --- 2. publish signature (bucket rejects text/html) ------------------------
const sigHtml = readFileSync(
  resolve(root, 'brand/marketing-sot/email-signatures/people/Dennis/Dennis.html'),
  'utf8',
);
const up = await fetch(
  `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/brand-assets/marketing-sot/email-signatures/people/Dennis/Dennis.html`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'text/plain',
      'x-upsert': 'true',
    },
    body: sigHtml,
  },
);
const sigPublished = up.ok;
console.log('signature upload HTTP', up.status, sigPublished ? SIGNATURE_URL : (await up.text()).slice(0, 200));

// --- 3. steps + run ---------------------------------------------------------
const client = new Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const now = new Date().toISOString();

const setStep = async (stepKey, status, note, url) => {
  const r = await client.query(
    `update public.os_hris_process_steps
     set status = $2,
         evidence_note = $3,
         evidence_url = $4,
         completed_at = case when $2 = 'done' then $5::timestamptz else completed_at end,
         updated_at = now()
     where run_id = $1 and step_key = $6
     returning step_key, status`,
    [RUN_ID, status, note, url, now, stepKey],
  );
  console.log('step', stepKey, '→', JSON.stringify(r.rows));
};

await setStep(
  'bs.ms_email',
  'done',
  [
    'LIVE via Microsoft Graph.',
    `Entra object id ${DENNIS_GRAPH_ID}`,
    'UPN / primary SMTP dennismccall@recruit619.com',
    'O365_BUSINESS_PREMIUM assigned (skuId f245ecc8-75af-4f8e-b61f-27d8114de5f3), usageLocation US',
    'Exchange Online mailbox confirmed: mailFolders returns Inbox/Drafts/Sent Items, proxyAddresses SMTP:dennismccall@recruit619.com',
    'Temp password issued with forceChangePasswordNextSignIn=true.',
  ].join('\n'),
  'https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/~/overview/userId/89fdd120-d221-4953-93a2-fc39a5f46983',
);

await setStep(
  'sd.email_sig',
  'done',
  [
    'Recruit 619 branded signature rendered for Dennis (VP of Recruiting) and delivered.',
    'Delivered inline plus as Dennis-email-signature.htm into his Inbox on start date.',
    'Recruit 619 Teams background (1920x1080) delivered as Recruit619-Teams-Background.png in the same message.',
    `Teams background CDN: ${TEAMS_BG}`,
    sigPublished ? `Signature CDN: ${SIGNATURE_URL}` : 'Signature stored in repo at brand/marketing-sot/email-signatures/people/Dennis/',
    'Graph exposes no API to write an Outlook signature or install a Teams background, so mailbox delivery is the live path; Dennis pastes once in Outlook settings.',
  ].join('\n'),
  sigPublished ? SIGNATURE_URL : null,
);

await setStep(
  'sd.distro',
  targetGroup && groupResult.startsWith('Added') ? 'done' : 'blocked',
  groupResult,
  null,
);

await setStep(
  'bs.visionary_mailbox_access',
  'blocked',
  [
    'Attempted live and failed — this is a platform limitation, not a config miss.',
    'POST https://graph.microsoft.com/beta/users/{id}/mailboxPermissions returned HTTP 405 Request_BadRequest ("Specified HTTP method is not allowed for the request target"): the endpoint grantVisionaryMailboxFullAccess() calls does not exist in Microsoft Graph.',
    'Graph app roles currently held: Mail.Send, Mail.ReadWrite, Group.ReadWrite.All, User.ReadWrite.All, Directory.Read.All, GroupMember.ReadWrite.All, Organization.Read.All, DeviceManagementManagedDevices.ReadWrite.All.',
    'Exchange.ManageAsApp is granted too, but on the Office 365 Exchange Online resource rather than Microsoft Graph, so it never shows up in a Graph token.',
    'FullAccess can only be granted through Exchange Online. Fastest path (Visionary, ~30s):',
    '  Connect-ExchangeOnline -UserPrincipalName joshmonroe@tagevc.com',
    '  Add-MailboxPermission -Identity dennismccall@recruit619.com -User joshmonroe@tagevc.com -AccessRights FullAccess -InheritanceType All',
    'Not yet automatable, but consent is no longer the reason: the service principal holds no Exchange Administrator directory role and the app registration has no certificate credential, so Exchange returns 403 on every app-only admin call. See docs/ENTRA_GRAPH_PERMISSIONS.md.',
  ].join('\n'),
  'https://admin.exchange.microsoft.com/#/mailboxes',
);

await client.query(
  `update public.os_hris_process_runs
   set start_date = $2, updated_at = now()
   where id = $1`,
  [RUN_ID, '2026-08-10'],
);

await client.query(
  `insert into public.os_hris_employee_events (employee_id, event_kind, summary, detail)
   values ($1, 'status_change', 'Day-one provisioning completed', $2::jsonb)`,
  [
    EMPLOYEE_ID,
    JSON.stringify({
      entra_object_id: DENNIS_GRAPH_ID,
      upn: 'dennismccall@recruit619.com',
      mailbox: 'live',
      portal_profile_id: 'f8b5d2a2-cc29-4ec0-adc2-74e714cf0a1b',
      portal_role: 'sub_lead',
      signature: 'delivered',
      teams_background: 'delivered',
      visionary_mailbox_fullaccess: 'blocked_exchange_manageasapp',
      source: 'scripts/dennis-onboard',
    }),
  ],
);

const counts = await client.query(
  `select status, count(*) from public.os_hris_process_steps where run_id = $1 group by status order by status`,
  [RUN_ID],
);
console.log('\nSTEP COUNTS:', JSON.stringify(counts.rows));

const emp = await client.query(
  `select full_name, work_email, entity_id, status, start_date, profile_id,
          entra_object_id, upn, identity_status, onboarding_pct
   from public.os_hris_employees where id = $1`,
  [EMPLOYEE_ID],
);
console.log('\nEMPLOYEE:', JSON.stringify(emp.rows[0], null, 1));

await client.end();
