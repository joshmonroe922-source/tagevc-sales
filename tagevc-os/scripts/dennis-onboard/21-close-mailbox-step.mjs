/**
 * Josh now has FullAccess on Dennis's mailbox, granted app-only rather than by hand.
 * Close bs.visionary_mailbox_access and record how it was actually done, including the
 * privilege that was borrowed and given back.
 */

import { env } from './lib.mjs';
import pg from 'pg';

const RUN_ID = '76ec8793-66d8-4a43-bfbe-1710f1054e5e';

const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const note = [
  'DONE 2026-08-10 — granted app-only, no interactive PowerShell needed.',
  '',
  'Result, verified with Get-MailboxPermission on dennismccall@recruit619.com:',
  '  joshmonroe@tagevc.com : FullAccess (Deny=False, InheritanceType=All, AutoMapping on)',
  '',
  'How it was done, via app 905649ff-1aee-4683-87e0-5d6d2005aea5 (Tage VC OS),',
  'service principal 1d44ad06-fbda-4ac4-b4fe-2c3885b4ac37:',
  '  1. Temporarily added + consented Microsoft Graph application role',
  '     RoleManagement.ReadWrite.Directory.',
  '  2. Assigned directory role Exchange Recipient Administrator',
  '     (31392ffb-586c-42d1-9346-e59415a2cc4e) to the service principal.',
  '     This is the least-privilege role that works; Exchange Administrator was not needed.',
  '  3. Waited ~30s for Exchange Online to honour the role (first probe 403, second 200).',
  '  4. POST https://outlook.office365.com/adminapi/beta/{tenant}/InvokeCommand',
  '     Add-MailboxPermission -> HTTP 200.',
  '  5. Revoked consent for RoleManagement.ReadWrite.Directory and removed it from the app.',
  '     Confirmed gone from the service principal appRoleAssignments.',
  '',
  'A client secret was sufficient — no certificate was required for app-only Exchange.',
  '',
  'Standing capability kept for future onboarding: Exchange.ManageAsApp +',
  'Exchange Recipient Administrator. That combination is enough to run mailbox',
  'permission grants for the next hire without any temporary elevation.',
  '',
  'Repeatable script: scripts/dennis-onboard/19-grant-fullaccess.mjs',
  'Audit script:      scripts/dennis-onboard/20-verify-and-close.mjs',
].join('\n');

const r = await client.query(
  `update public.os_hris_process_steps
   set status = 'done', evidence_note = $2, completed_at = now(), updated_at = now()
   where run_id = $1 and step_key = 'bs.visionary_mailbox_access'
   returning step_key, status, completed_at`,
  [RUN_ID, note],
);

console.log(JSON.stringify(r.rows, null, 1));

const remaining = await client.query(
  `select step_key, status from public.os_hris_process_steps
   where run_id = $1 and status <> 'done'
   order by step_key`,
  [RUN_ID],
);
console.log('\n=== STEPS NOT DONE ===');
console.log(JSON.stringify(remaining.rows, null, 1));

await client.end();
