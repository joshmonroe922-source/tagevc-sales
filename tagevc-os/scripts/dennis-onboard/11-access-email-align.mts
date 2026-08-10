/**
 * Align Dennis McCall's portal/CRM access email to his new Microsoft primary
 * (dennismccall@recruit619.com) and re-drive the joiner assist.
 *
 * Josh renamed the Entra UPN + primary SMTP to dennismccall@recruit619.com and
 * kept dennis@recruit619.com as an alias. Portal sign-in is Microsoft OAuth, so
 * every stored login email has to follow the UPN or Supabase will mint a second
 * auth user on his first sign-in and he loses his sub_lead / ENT-R619 profile.
 *
 *   npm exec --yes tsx@4 -- scripts/dennis-onboard/11-access-email-align.mts
 *   npm exec --yes tsx@4 -- scripts/dennis-onboard/11-access-email-align.mts --apply
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
const SEND_INVITE = process.argv.includes('--send-invite');

const EMPLOYEE_ID = '3d7937db-34f1-4be1-82a6-21e84b2b26a7';
const RUN_ID = '76ec8793-66d8-4a43-bfbe-1710f1054e5e';
const PROFILE_ID = 'f8b5d2a2-cc29-4ec0-adc2-74e714cf0a1b';
const ENTRA_ID = '89fdd120-d221-4953-93a2-fc39a5f46983';

const ACCESS_EMAIL = 'dennismccall@recruit619.com';
const OLD_EMAIL = 'dennis@recruit619.com';
const FULL_NAME = 'Dennis McCall';

const { getEmployee, updateEmployee } = await import('@/lib/hris/employees');
const { getRunWithSteps, updateStepStatus } = await import('@/lib/hris/runs');
const { dispatchHrisStepAssist } = await import('@/lib/hris/step-assists');
const { createServiceRoleClient } = await import('@/lib/supabase/persist-client');
const { getMsGraphToken } = await import('@/lib/shared-services/it-mdm');

const tag = APPLY ? '' : '[dry-run] ';
const say = (s: string) => console.log(s);

say(`=== Dennis McCall · access-email align ${APPLY ? '(APPLY)' : '(DRY RUN)'} ===\n`);

// ------------------------------------------------- 1. confirm Microsoft is the source
const tok = await getMsGraphToken();
if (!tok.ok) throw new Error(`Graph token unavailable: ${tok.detail}`);
const entra = await fetch(
  `https://graph.microsoft.com/v1.0/users/${ENTRA_ID}?$select=userPrincipalName,mail,proxyAddresses,displayName,givenName,surname,accountEnabled`,
  { headers: { Authorization: `Bearer ${tok.token}` } },
).then((r) => r.json());

say(`entra UPN      : ${entra.userPrincipalName}`);
say(`entra mail     : ${entra.mail}`);
say(`entra proxies  : ${JSON.stringify(entra.proxyAddresses)}`);
say(`entra name     : ${entra.displayName} (${entra.givenName} / ${entra.surname})`);

if (entra.userPrincipalName?.toLowerCase() !== ACCESS_EMAIL) {
  throw new Error(
    `Refusing to run: Entra UPN is ${entra.userPrincipalName}, expected ${ACCESS_EMAIL}. ` +
      `Portal login email must follow the UPN.`,
  );
}
const aliasKept = (entra.proxyAddresses ?? []).some(
  (p: string) => p.toLowerCase() === `smtp:${OLD_EMAIL}`,
);
say(`alias ${OLD_EMAIL} retained: ${aliasKept ? 'yes' : 'NO — mail to it will bounce'}`);

const sb = createServiceRoleClient();

// -------------------------------------------------- 2. auth.users (the actual login)
const { data: authUser, error: authErr } = await sb.auth.admin.getUserById(PROFILE_ID);
if (authErr) throw new Error(`auth lookup failed: ${authErr.message}`);
say(`\nauth.users     : ${authUser.user?.email} (providers=${JSON.stringify(authUser.user?.app_metadata?.providers)})`);

if (authUser.user?.email?.toLowerCase() !== ACCESS_EMAIL) {
  say(
    `${tag}auth.users.email ${authUser.user?.email} -> ${ACCESS_EMAIL}` +
      `\n   without this, Microsoft OAuth creates a NEW auth user and drops his sub_lead/ENT-R619 profile`,
  );
  if (APPLY) {
    const { error } = await sb.auth.admin.updateUserById(PROFILE_ID, {
      email: ACCESS_EMAIL,
      email_confirm: true,
      user_metadata: {
        ...(authUser.user?.user_metadata ?? {}),
        full_name: FULL_NAME,
      },
    });
    say(error ? `   FAILED: ${error.message}` : '   ok');
  }
} else {
  say('auth.users.email already aligned');
}

// ------------------------------------------------------------- 3. profiles (CRM/portal)
const { data: prof } = await sb
  .from('profiles')
  .select('id, email, full_name, role, entity_id, active')
  .eq('id', PROFILE_ID)
  .maybeSingle();
say(`\nprofiles       : ${prof?.email} · ${prof?.full_name} · ${prof?.role} · ${prof?.entity_id}`);

// R619-only Leadership scoping must survive this edit.
if (prof?.role !== 'sub_lead' || prof?.entity_id !== 'ENT-R619') {
  throw new Error(
    `Refusing to run: expected role=sub_lead entity=ENT-R619, found ${prof?.role}/${prof?.entity_id}`,
  );
}
if (prof?.email?.toLowerCase() !== ACCESS_EMAIL || prof?.full_name !== FULL_NAME) {
  say(`${tag}profiles.email -> ${ACCESS_EMAIL}, full_name -> ${FULL_NAME}`);
  if (APPLY) {
    const { error } = await sb
      .from('profiles')
      .update({ email: ACCESS_EMAIL, full_name: FULL_NAME })
      .eq('id', PROFILE_ID);
    say(error ? `   FAILED: ${error.message}` : '   ok');
  }
} else {
  say('profiles already aligned');
}

// ------------------------------------------------------------------ 4. HRIS work_email
const empRes = await getEmployee(EMPLOYEE_ID);
const emp = empRes.employee;
if (!emp) throw new Error('employee not found');
say(`\nHRIS           : work_email=${emp.work_email} upn=${emp.upn ?? '-'} status=${emp.status}`);
if (emp.work_email.toLowerCase() !== ACCESS_EMAIL) {
  say(`${tag}os_hris_employees.work_email -> ${ACCESS_EMAIL}`);
  if (APPLY) {
    const r = await updateEmployee(EMPLOYEE_ID, { work_email: ACCESS_EMAIL });
    say(r.ok ? '   ok' : `   FAILED: ${r.error}`);
  }
}
if ((emp.upn ?? '').toLowerCase() !== ACCESS_EMAIL) {
  say(`${tag}os_hris_employees.upn -> ${ACCESS_EMAIL}`);
  if (APPLY) {
    const { error } = await sb
      .from('os_hris_employees')
      .update({ upn: ACCESS_EMAIL })
      .eq('id', EMPLOYEE_ID);
    say(error ? `   FAILED: ${error.message}` : '   ok');
  }
}

// --------------------------------------------------------- 5. R619 desk roster (CRM side)
const { data: roster } = await sb
  .from('r619_desk_roster')
  .select('id, email')
  .eq('email', OLD_EMAIL);
say(`\nr619_desk_roster rows on ${OLD_EMAIL}: ${roster?.length ?? 0}`);
if (roster && roster.length > 0) {
  say(`${tag}r619_desk_roster.email -> ${ACCESS_EMAIL}`);
  if (APPLY) {
    const { error } = await sb
      .from('r619_desk_roster')
      .update({ email: ACCESS_EMAIL })
      .eq('email', OLD_EMAIL);
    say(error ? `   FAILED: ${error.message}` : '   ok');
  }
}

// ------------------------------------- 6. re-drive the joiner now work_email is correct
const runRes = await getRunWithSteps(RUN_ID);
const step = (runRes.run?.steps ?? []).find((s) => s.step_key === 'bs.ms_email');
if (!step) {
  say('\nbs.ms_email not in run — skipped');
} else if (!APPLY) {
  say(`\n${tag}re-dispatch bs.ms_email (Graph joiner) with corrected work_email`);
  say(`${tag}${SEND_INVITE ? 'WOULD send' : 'would NOT send'} the personal-email sign-in invite`);
} else {
  // Suppress the invite unless explicitly asked, so a re-run cannot spam the hire.
  if (!SEND_INVITE) process.env.HRIS_JOINER_INVITE_EMAIL = '0';
  const assist = await dispatchHrisStepAssist({
    step,
    employeeId: EMPLOYEE_ID,
    actorId: null,
  });
  say(`\nbs.ms_email assist: ${assist.detail}`);
  const upd = await updateStepStatus({
    step_id: step.id,
    status: 'done',
    evidence_note: assist.evidence_note ?? assist.detail,
  });
  say(upd.ok ? `  step done (run ${upd.run.completion_pct}%)` : `  FAILED: ${upd.error}`);
}

// --------------------------------------------------------------------- 7. verification
const after = await getEmployee(EMPLOYEE_ID);
const { data: authAfter } = await sb.auth.admin.getUserById(PROFILE_ID);
const { data: profAfter } = await sb
  .from('profiles')
  .select('email, full_name, role, entity_id')
  .eq('id', PROFILE_ID)
  .maybeSingle();
const runAfter = await getRunWithSteps(RUN_ID);
const counts = (runAfter.run?.steps ?? []).reduce<Record<string, number>>((acc, s) => {
  acc[s.status] = (acc[s.status] ?? 0) + 1;
  return acc;
}, {});

say('\n=== AFTER ===');
say(`auth login     : ${authAfter?.user?.email}`);
say(`profiles       : ${profAfter?.email} · ${profAfter?.full_name} · ${profAfter?.role} · ${profAfter?.entity_id}`);
say(`HRIS           : ${after.employee?.work_email} · upn=${after.employee?.upn} · ${after.employee?.status}`);
say(`run            : ${runAfter.run?.status} ${runAfter.run?.completion_pct}% ${JSON.stringify(counts)}`);
