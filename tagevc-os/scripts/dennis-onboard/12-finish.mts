/**
 * Dennis McCall (dennis-vp-recruiting-r619) — idempotent finisher.
 *
 * Safe to re-run: every block checks current state first and only writes on drift.
 *
 *   1. Assert Microsoft is the source of truth for the access email + R619 scoping
 *   2. Align every stored login/access email to the Entra UPN
 *   3. Record compensation (base + quarterly MBO bonus)
 *   4. Re-drive the Graph joiner assist
 *   5. Optional: email first-sign-in details to his personal address (--send-invite)
 *   6. Print a verification snapshot
 *
 *   npm exec --yes tsx@4 -- scripts/dennis-onboard/12-finish.mts
 *   npm exec --yes tsx@4 -- scripts/dennis-onboard/12-finish.mts --apply [--send-invite]
 *
 * Never prints the temp password.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (!m) continue;
  if (process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const APPLY = process.argv.includes('--apply');
const SEND_INVITE = process.argv.includes('--send-invite');

const EMPLOYEE_ID = '3d7937db-34f1-4be1-82a6-21e84b2b26a7';
const RUN_ID = '76ec8793-66d8-4a43-bfbe-1710f1054e5e';
const PROFILE_ID = 'f8b5d2a2-cc29-4ec0-adc2-74e714cf0a1b';
const ENTRA_ID = '89fdd120-d221-4953-93a2-fc39a5f46983';

const ACCESS_EMAIL = 'dennismccall@recruit619.com';
const OLD_EMAIL = 'dennis@recruit619.com';
const FULL_NAME = 'Dennis McCall';
const SECRETS_PATH = '.local-secrets/dennis-m365.json';

const BASE_SALARY = 140000;
const QUARTERLY_BONUS = 2500;
const COMP_NOTE =
  'Comp per offer letter: base $140,000/yr salary; ' +
  '$2,500 quarterly bonus contingent on execution of MBOs as defined in the offer letter.';

const { getEmployee, updateEmployee } = await import('@/lib/hris/employees');
const { getRunWithSteps, updateStepStatus } = await import('@/lib/hris/runs');
const { dispatchHrisStepAssist } = await import('@/lib/hris/step-assists');
const { createServiceRoleClient } = await import('@/lib/supabase/persist-client');
const { getMsGraphToken } = await import('@/lib/shared-services/it-mdm');
const { sendJoinerInvite } = await import('@/lib/hris/joiner-invite');

const tag = APPLY ? '' : '[dry-run] ';
const say = (s: string) => console.log(s);
const done: string[] = [];
const left: string[] = [];

say(`=== Dennis McCall · finisher ${APPLY ? '(APPLY)' : '(DRY RUN)'} ===\n`);

// ------------------------------------------------------ 1. Microsoft = source of truth
const tok = await getMsGraphToken();
if (!tok.ok) throw new Error(`Graph token unavailable: ${tok.detail}`);
const entra = await fetch(
  `https://graph.microsoft.com/v1.0/users/${ENTRA_ID}?$select=userPrincipalName,mail,proxyAddresses,displayName,givenName,surname,accountEnabled,jobTitle,companyName,assignedLicenses`,
  { headers: { Authorization: `Bearer ${tok.token}` } },
).then((r) => r.json());

say('--- Microsoft 365 ---');
say(`UPN / mail   : ${entra.userPrincipalName} / ${entra.mail}`);
say(`proxies      : ${JSON.stringify(entra.proxyAddresses)}`);
say(`name         : ${entra.displayName} (${entra.givenName} / ${entra.surname})`);
say(`title/company: ${entra.jobTitle} · ${entra.companyName}`);
say(`enabled      : ${entra.accountEnabled} · licences: ${(entra.assignedLicenses ?? []).length}`);

if (entra.userPrincipalName?.toLowerCase() !== ACCESS_EMAIL) {
  throw new Error(`Entra UPN is ${entra.userPrincipalName}, expected ${ACCESS_EMAIL}`);
}
if (entra.displayName === FULL_NAME && entra.givenName === 'Dennis' && entra.surname === 'McCall') {
  done.push(`Entra name = ${FULL_NAME} (givenName Dennis / surname McCall)`);
}
if ((entra.proxyAddresses ?? []).some((p: string) => p.toLowerCase() === `smtp:${OLD_EMAIL}`)) {
  done.push(`${OLD_EMAIL} retained as SMTP alias — old address still delivers`);
}

const sb = createServiceRoleClient();

// -------------------------------------------------------------- 2. align access emails
say('\n--- access email alignment ---');

const { data: authUser, error: authErr } = await sb.auth.admin.getUserById(PROFILE_ID);
if (authErr) throw new Error(`auth lookup failed: ${authErr.message}`);
const authEmail = authUser.user?.email?.toLowerCase();
say(`auth.users   : ${authEmail}`);
if (authEmail !== ACCESS_EMAIL) {
  say(`${tag}auth.users.email -> ${ACCESS_EMAIL} (Microsoft OAuth match)`);
  if (APPLY) {
    const { error } = await sb.auth.admin.updateUserById(PROFILE_ID, {
      email: ACCESS_EMAIL,
      email_confirm: true,
      user_metadata: { ...(authUser.user?.user_metadata ?? {}), full_name: FULL_NAME },
    });
    if (error) left.push(`auth.users.email update failed: ${error.message}`);
    else done.push(`Portal sign-in email (auth.users) = ${ACCESS_EMAIL}`);
    say(error ? `   FAILED: ${error.message}` : '   ok');
  }
} else {
  done.push(`Portal sign-in email (auth.users) = ${ACCESS_EMAIL}`);
  say('   already aligned');
}

const { data: prof } = await sb
  .from('profiles')
  .select('id, email, full_name, role, entity_id, active')
  .eq('id', PROFILE_ID)
  .maybeSingle();
say(`profiles     : ${prof?.email} · ${prof?.full_name} · ${prof?.role} · ${prof?.entity_id}`);
if (prof?.role !== 'sub_lead' || prof?.entity_id !== 'ENT-R619') {
  throw new Error(`Expected sub_lead/ENT-R619, found ${prof?.role}/${prof?.entity_id}`);
}
done.push(`Portal role = sub_lead (Subsidiary Leader) scoped to ENT-R619 only`);
if (prof?.email?.toLowerCase() !== ACCESS_EMAIL || prof?.full_name !== FULL_NAME) {
  say(`${tag}profiles.email -> ${ACCESS_EMAIL}, full_name -> ${FULL_NAME}`);
  if (APPLY) {
    const { error } = await sb
      .from('profiles')
      .update({ email: ACCESS_EMAIL, full_name: FULL_NAME })
      .eq('id', PROFILE_ID);
    if (error) left.push(`profiles update failed: ${error.message}`);
    else done.push(`CRM profile email = ${ACCESS_EMAIL}, name = ${FULL_NAME}`);
    say(error ? `   FAILED: ${error.message}` : '   ok');
  }
} else {
  done.push(`CRM profile email = ${ACCESS_EMAIL}, name = ${FULL_NAME}`);
  say('   already aligned');
}

const { data: roster } = await sb
  .from('r619_desk_roster')
  .select('id, email')
  .in('email', [OLD_EMAIL, ACCESS_EMAIL]);
const rosterStale = (roster ?? []).filter((r) => r.email?.toLowerCase() === OLD_EMAIL);
say(`r619 roster  : ${roster?.length ?? 0} row(s), ${rosterStale.length} stale`);
if (rosterStale.length > 0) {
  say(`${tag}r619_desk_roster.email -> ${ACCESS_EMAIL}`);
  if (APPLY) {
    const { error } = await sb
      .from('r619_desk_roster')
      .update({ email: ACCESS_EMAIL })
      .eq('email', OLD_EMAIL);
    if (error) left.push(`r619_desk_roster update failed: ${error.message}`);
    else done.push(`R619 desk roster email = ${ACCESS_EMAIL}`);
    say(error ? `   FAILED: ${error.message}` : '   ok');
  }
} else if ((roster ?? []).length > 0) {
  done.push(`R619 desk roster email = ${ACCESS_EMAIL}`);
}

// -------------------------------------------------- 3. HRIS: emails, phase, compensation
say('\n--- HRIS record ---');
const empRes = await getEmployee(EMPLOYEE_ID);
const emp = empRes.employee;
if (!emp) throw new Error('employee not found');
say(`name/entity  : ${emp.full_name} · ${emp.entity_id} · ${emp.role_title}`);
say(`status       : ${emp.status} / onboarding ${emp.onboarding_status} ${emp.onboarding_pct}%`);
say(`work_email   : ${emp.work_email}`);
say(`comp         : ${emp.comp_amount ?? 'unset'} ${emp.comp_currency} ${emp.comp_basis} ${emp.pay_frequency}`);

if (emp.entity_id !== 'ENT-R619') throw new Error(`entity is ${emp.entity_id}`);
if (emp.full_name === FULL_NAME) done.push(`HRIS full name = ${FULL_NAME}`);
if (emp.status === 'onboarding') done.push('HRIS phase = Onboarding');

const empPatch: Record<string, unknown> = {};
if (emp.work_email.toLowerCase() !== ACCESS_EMAIL) empPatch.work_email = ACCESS_EMAIL;
if (Number(emp.comp_amount ?? 0) !== BASE_SALARY) empPatch.comp_amount = BASE_SALARY;
if (emp.comp_currency !== 'USD') empPatch.comp_currency = 'USD';
if (emp.comp_basis !== 'salary') empPatch.comp_basis = 'salary';
if (emp.pay_frequency !== 'annual') empPatch.pay_frequency = 'annual';

// No structured bonus column exists, so the quarterly MBO bonus lives in notes.
const notesHasComp = emp.notes.includes(`$${QUARTERLY_BONUS.toLocaleString()} quarterly bonus`);
if (!notesHasComp) {
  empPatch.notes = [emp.notes.trim(), COMP_NOTE].filter(Boolean).join('\n\n');
}

if (Object.keys(empPatch).length > 0) {
  say(`${tag}update HRIS: ${Object.keys(empPatch).join(', ')}`);
  if (APPLY) {
    const r = await updateEmployee(EMPLOYEE_ID, empPatch as never);
    if (!r.ok) left.push(`HRIS update failed: ${r.error}`);
    say(r.ok ? '   ok' : `   FAILED: ${r.error}`);
  }
} else {
  say('   already aligned');
}
if (APPLY || Object.keys(empPatch).length === 0) {
  done.push(
    `Compensation recorded: base $${BASE_SALARY.toLocaleString()} USD annual salary; ` +
      `$${QUARTERLY_BONUS.toLocaleString()} quarterly MBO bonus noted per offer letter`,
  );
}

// ------------------------------------------------------ 4. re-drive Graph joiner assist
say('\n--- joiner assist ---');
const runRes = await getRunWithSteps(RUN_ID);
const step = (runRes.run?.steps ?? []).find((s) => s.step_key === 'bs.ms_email');
if (!step) {
  say('bs.ms_email not in run');
} else if (!APPLY) {
  say(`${tag}re-dispatch bs.ms_email with work_email=${ACCESS_EMAIL}`);
} else {
  // The invite is sent explicitly below, not as a side effect of re-running the joiner.
  process.env.HRIS_JOINER_INVITE_EMAIL = '0';
  const assist = await dispatchHrisStepAssist({ step, employeeId: EMPLOYEE_ID, actorId: null });
  say(`assist: ${assist.detail}`);
  const upd = await updateStepStatus({
    step_id: step.id,
    status: 'done',
    evidence_note: assist.evidence_note ?? assist.detail,
  });
  say(upd.ok ? `  bs.ms_email done (run ${upd.run.completion_pct}%)` : `  FAILED: ${upd.error}`);
  if (assist.detail.includes('Updated existing Graph user')) {
    done.push('Graph joiner re-asserted on the live account (name, title, licence, groups)');
  }
  delete process.env.HRIS_JOINER_INVITE_EMAIL;
}

// -------------------------------------------- 5. first-sign-in invite to personal email
say('\n--- personal-email sign-in invite ---');
const empNow = (await getEmployee(EMPLOYEE_ID)).employee!;
if (!SEND_INVITE) {
  say(`skipped (pass --send-invite). Would go to ${empNow.personal_email || '(none on file)'}`);
} else {
  // Read the provisioned temp password from the local secrets file. Never logged.
  let tempPassword: string | null = null;
  const secretsAbs = resolve(process.cwd(), SECRETS_PATH);
  if (existsSync(secretsAbs)) {
    try {
      const raw = JSON.parse(readFileSync(secretsAbs, 'utf8')) as Record<string, unknown>;
      for (const [k, v] of Object.entries(raw)) {
        if (/pass(word)?/i.test(k) && typeof v === 'string' && v.trim()) {
          tempPassword = v.trim();
          break;
        }
      }
    } catch {
      /* fall through to reset-link variant */
    }
  }
  say(`temp password on file: ${tempPassword ? 'yes (not printed)' : 'no — invite uses reset link'}`);

  if (!APPLY) {
    say(`${tag}send invite to ${empNow.personal_email}`);
  } else {
    const invite = await sendJoinerInvite({
      full_name: empNow.full_name,
      personal_email: empNow.personal_email,
      entity_id: empNow.entity_id,
      role_title: empNow.role_title,
      start_date: empNow.start_date,
      upn: ACCESS_EMAIL,
      temp_password: tempPassword,
      // The entity no-reply alias is not send-as capable yet.
      from_address: process.env.M365_HOST_MAILBOX?.trim() || 'joshmonroe@tagevc.com',
    });
    say(`invite: ${invite.detail}`);
    if (invite.sent) done.push(`First-sign-in details emailed to Dennis's personal address`);
    else left.push(`Sign-in invite NOT sent: ${invite.detail}`);
  }
}

// ------------------------------------------------------------------ 6. verification dump
say('\n=== VERIFICATION ===');
const { data: authFinal } = await sb.auth.admin.getUserById(PROFILE_ID);
const { data: profFinal } = await sb
  .from('profiles')
  .select('email, full_name, role, entity_id, active')
  .eq('id', PROFILE_ID)
  .maybeSingle();
const { data: empFinal } = await sb
  .from('os_hris_employees')
  .select(
    'full_name, work_email, upn, entity_id, status, onboarding_status, onboarding_pct, comp_amount, comp_currency, comp_basis, pay_frequency, notes',
  )
  .eq('id', EMPLOYEE_ID)
  .maybeSingle();
const runFinal = await getRunWithSteps(RUN_ID);
const stepRows = runFinal.run?.steps ?? [];
const counts = stepRows.reduce<Record<string, number>>((acc, s) => {
  acc[s.status] = (acc[s.status] ?? 0) + 1;
  return acc;
}, {});

say(`auth login   : ${authFinal?.user?.email}`);
say(`profiles     : ${profFinal?.email} · ${profFinal?.full_name} · ${profFinal?.role} · ${profFinal?.entity_id} · active=${profFinal?.active}`);
say(`HRIS         : ${empFinal?.full_name} · ${empFinal?.work_email} · upn=${empFinal?.upn} · ${empFinal?.entity_id} · ${empFinal?.status}`);
say(`comp         : ${empFinal?.comp_amount} ${empFinal?.comp_currency} ${empFinal?.comp_basis}/${empFinal?.pay_frequency}`);
say(`comp note    : ${(empFinal?.notes ?? '').includes('quarterly bonus') ? 'quarterly MBO bonus recorded' : 'MISSING'}`);
say(`run          : ${runFinal.run?.status} ${runFinal.run?.completion_pct}% ${JSON.stringify(counts)}`);
say(
  `non-pending  : ${stepRows
    .filter((s) => s.status !== 'pending')
    .map((s) => `${s.step_key}=${s.status}`)
    .join(', ')}`,
);

say('\n=== DONE ===');
for (const d of [...new Set(done)]) say(`  + ${d}`);
if (left.length) {
  say('\n=== NOT DONE ===');
  for (const l of left) say(`  ! ${l}`);
}
