/**
 * Send Dennis his day-one welcome/invite at the personal address on file, so he can
 * get oriented before he can reach the new work mailbox.
 *
 * Uses Graph sendMail as Josh (needs the Mail.Send application role, consented
 * 2026-08-10). Deliberately carries no credentials — the temp password is issued
 * out of band.
 *
 *   node scripts/dennis-onboard/16-personal-email-invite.mjs           # dry run
 *   node scripts/dennis-onboard/16-personal-email-invite.mjs --apply   # send
 */

import { graph, env } from './lib.mjs';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const EMPLOYEE_ID = '3d7937db-34f1-4be1-82a6-21e84b2b26a7';
const SENDER = env.M365_HOST_MAILBOX || 'joshmonroe@tagevc.com';

const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows } = await client.query(
  `select full_name, work_email, personal_email, role_title, start_date::date as start_date
   from public.os_hris_employees where id = $1`,
  [EMPLOYEE_ID],
);
const emp = rows[0];

if (!emp?.personal_email) {
  console.log('No personal_email on file — nothing to send.');
  await client.end();
  process.exit(0);
}

const firstName = (emp.full_name || '').split(' ')[0] || 'there';
const subject = `Welcome to Recruit 619, ${firstName} — your day-one access`;

const html = `
<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a;max-width:620px">
  <p>Hi ${firstName},</p>

  <p>Welcome aboard as <strong>${emp.role_title}</strong> at Recruit 619. Sending this to your
  personal address so you have everything in one place before you sign in for the first time.</p>

  <h3 style="margin:24px 0 8px;font-size:16px">Your work account</h3>
  <p style="margin:0 0 4px"><strong>Email / sign-in:</strong> ${emp.work_email}</p>
  <p style="margin:0 0 4px"><strong>Start date:</strong> ${emp.start_date}</p>
  <p style="margin:0 0 4px;color:#555">Your temporary password is being sent to you separately.
  You'll be asked to set a new one the first time you sign in.</p>

  <h3 style="margin:24px 0 8px;font-size:16px">Where to go</h3>
  <ul style="margin:0;padding-left:20px">
    <li><a href="https://outlook.office.com">Outlook / Microsoft 365</a> — email, calendar, Teams</li>
    <li><a href="https://portal.recruit619.com">Recruit 619 Portal</a> — jobs, candidates, accounts</li>
    <li><a href="https://app.tagevc.com">Tage OS</a> — HR, onboarding checklist, company resources</li>
  </ul>

  <h3 style="margin:24px 0 8px;font-size:16px">First steps</h3>
  <ol style="margin:0;padding-left:20px">
    <li>Sign in to Microsoft 365 with your work email and set your password.</li>
    <li>Open Tage OS and work through your onboarding checklist (I-9, direct deposit, handbook).</li>
    <li>Check your work inbox — your email signature and Teams background are already waiting there.</li>
  </ol>

  <p style="margin-top:24px">Anything at all, just reply to this note or reach me at
  <a href="mailto:${SENDER}">${SENDER}</a>. Glad to have you with us.</p>

  <p style="margin-top:20px">Josh Monroe<br>
  <span style="color:#666">Tage Venture Capital · Recruit 619</span></p>
</div>`.trim();

console.log('--- invite ---');
console.log('from:   ', SENDER);
console.log('to:     ', emp.personal_email);
console.log('subject:', subject);

if (!APPLY) {
  console.log('\nDRY RUN — re-run with --apply to send.');
  await client.end();
  process.exit(0);
}

const send = await graph(`v1.0/users/${encodeURIComponent(SENDER)}/sendMail`, {
  method: 'POST',
  body: JSON.stringify({
    message: {
      subject,
      body: { contentType: 'HTML', content: html },
      toRecipients: [{ emailAddress: { address: emp.personal_email } }],
      ccRecipients: [{ emailAddress: { address: emp.work_email } }],
    },
    saveToSentItems: true,
  }),
});

console.log(`\nsendMail HTTP ${send.status}`);
if (!send.ok) {
  console.log(JSON.stringify(send.body, null, 1).slice(0, 800));
  await client.end();
  process.exit(1);
}

console.log('Sent.');

await client.query(
  `insert into public.os_hris_employee_events (employee_id, event_kind, summary, detail)
   values ($1, 'note', 'Day-one invite sent to personal email', $2::jsonb)`,
  [
    EMPLOYEE_ID,
    JSON.stringify({
      to: emp.personal_email,
      cc: emp.work_email,
      from: SENDER,
      subject,
      via: 'graph.sendMail (Mail.Send app role)',
      source: 'scripts/dennis-onboard/16-personal-email-invite.mjs',
    }),
  ],
);

console.log('Logged employee event.');
await client.end();
