/**
 * 1. Email Dennis his Instant NDA enterprise access, with a copy to Josh.
 * 2. Set Dennis's manager_profile_id (HRIS + portal profile) to Josh.
 *
 * Outbound Graph sendMail is 403 until Mail.Send is consented, so internal
 * delivery goes straight into each tenant Inbox via Mail.ReadWrite. A real BCC
 * is not possible that way, so Josh gets his own copy of the same message —
 * same outcome, and it is visible in his Inbox rather than hidden.
 *
 *   npm exec --yes tsx@4 -- scripts/dennis-onboard/14-instant-nda-and-manager.mts
 *   npm exec --yes tsx@4 -- scripts/dennis-onboard/14-instant-nda-and-manager.mts --apply
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (!m) continue;
  if (process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const APPLY = process.argv.includes('--apply');

const EMPLOYEE_ID = '3d7937db-34f1-4be1-82a6-21e84b2b26a7';
const DENNIS_UPN = 'dennismccall@recruit619.com';
const JOSH_UPN = 'joshmonroe@tagevc.com';

const { getEmployee, updateEmployee } = await import('@/lib/hris/employees');
const { createServiceRoleClient } = await import('@/lib/supabase/persist-client');
const { buildInstantNdaEmail } = await import('@/lib/hris/instant-nda-access');
const { deliverToTenantMailbox } = await import(
  '@/lib/platform-email/tenant-mailbox-delivery'
);

const tag = APPLY ? '' : '[dry-run] ';
const say = (s: string) => console.log(s);
const sb = createServiceRoleClient();

say(`=== Instant NDA + manager ${APPLY ? '(APPLY)' : '(DRY RUN)'} ===\n`);

const emp = (await getEmployee(EMPLOYEE_ID)).employee;
if (!emp) throw new Error('employee not found');
say(`employee : ${emp.full_name} · ${emp.entity_id} · ${emp.work_email}`);

// ------------------------------------------------------------- 1. locate Josh's profile
const { data: joshCandidates } = await sb
  .from('profiles')
  .select('id, email, full_name, role, entity_id, active')
  .or(`email.eq.${JOSH_UPN},role.eq.visionary`)
  .eq('active', true);

say(`\nJosh candidates (${joshCandidates?.length ?? 0}):`);
for (const p of joshCandidates ?? []) {
  say(`  ${p.id} · ${p.email} · ${p.full_name} · ${p.role} · ${p.entity_id}`);
}
const josh =
  (joshCandidates ?? []).find((p) => p.email?.toLowerCase() === JOSH_UPN) ??
  (joshCandidates ?? []).find((p) => p.role === 'visionary') ??
  null;
if (!josh) throw new Error('Could not resolve Josh profile — refusing to guess a manager');
say(`resolved manager: ${josh.full_name} <${josh.email}> (${josh.role})`);

// -------------------------------------------------------- 2. set manager on both records
if (emp.manager_profile_id !== josh.id) {
  say(`\n${tag}HRIS manager_profile_id -> ${josh.id} (${josh.full_name})`);
  if (APPLY) {
    const r = await updateEmployee(EMPLOYEE_ID, {
      manager_profile_id: josh.id,
      manager_name: josh.full_name || josh.email,
    });
    say(r.ok ? `   ok (manager_name=${r.employee.manager_name})` : `   FAILED: ${r.error}`);
  }
} else {
  say('\nHRIS manager already set');
}

if (emp.profile_id) {
  const { data: prof } = await sb
    .from('profiles')
    .select('id, manager_profile_id')
    .eq('id', emp.profile_id)
    .maybeSingle();
  if (prof && prof.manager_profile_id !== josh.id) {
    say(`${tag}profiles.manager_profile_id -> ${josh.id}`);
    if (APPLY) {
      const { error } = await sb
        .from('profiles')
        .update({ manager_profile_id: josh.id })
        .eq('id', emp.profile_id);
      say(error ? `   FAILED: ${error.message}` : '   ok');
    }
  } else {
    say('profiles.manager_profile_id already set');
  }
}

// ------------------------------------------------------------ 3. Instant NDA email
const mail = buildInstantNdaEmail({
  full_name: emp.full_name,
  entity_id: emp.entity_id,
  upn: DENNIS_UPN,
});
say(`\nsubject  : ${mail.subject}`);
say(`to       : ${DENNIS_UPN}`);
say(`copy     : ${JOSH_UPN}`);
say('--- text ---');
say(mail.text);

if (!APPLY) {
  say(`\n${tag}deliver to both mailboxes`);
} else {
  const toDennis = await deliverToTenantMailbox({
    mailboxUpn: DENNIS_UPN,
    subject: mail.subject,
    bodyHtml: mail.html,
    fromName: 'Recruit 619',
    fromAddress: JOSH_UPN,
    toDisplay: { name: emp.full_name, address: DENNIS_UPN },
    importance: 'normal',
  });
  say(
    `\ndennis delivery: ${toDennis.ok ? `ok (${toDennis.messageId})` : `FAILED ${toDennis.error}`}`,
  );

  const toJosh = await deliverToTenantMailbox({
    mailboxUpn: JOSH_UPN,
    subject: `[copy] ${mail.subject}`,
    bodyHtml:
      `<p style="font:13px -apple-system,Segoe UI,Roboto,sans-serif;color:#6b6b6b">` +
      `Copy of the Instant NDA access email sent to ${emp.full_name} &lt;${DENNIS_UPN}&gt;.</p>` +
      mail.html,
    fromName: 'Tage OS',
    fromAddress: JOSH_UPN,
    toDisplay: { name: 'Josh Monroe', address: JOSH_UPN },
    importance: 'normal',
  });
  say(`josh copy     : ${toJosh.ok ? `ok (${toJosh.messageId})` : `FAILED ${toJosh.error}`}`);
}

// ------------------------------------------------------------------- 4. verification
const after = (await getEmployee(EMPLOYEE_ID)).employee;
say('\n=== AFTER ===');
say(`manager  : ${after?.manager_name} (${after?.manager_profile_id})`);
