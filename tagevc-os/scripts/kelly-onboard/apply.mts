/**
 * Kelly Hipskind — post–Admin Center mailbox + portal access (4 OS).
 * Does NOT set or log passwords. Microsoft OAuth uses Entra credentials.
 *
 *   npm exec --yes tsx@4 -- scripts/kelly-onboard/apply.mts
 *   npm exec --yes tsx@4 -- scripts/kelly-onboard/apply.mts --apply
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const APPLY = process.argv.includes('--apply');

const EMPLOYEE_ID = 'aee6fda8-2a8b-4fac-b2da-91c3252954b6';
const ACCESS_EMAIL = 'kellyhipskind@tagevc.com';
const FULL_NAME = 'Kelly Hipskind';
const ROLE = 'coo';
const ENTITY = 'ENT-FIRM';

const tag = APPLY ? '' : '[dry-run] ';
const say = (s: string) => console.log(s);

say(`=== Kelly Hipskind onboarding ${APPLY ? '(APPLY)' : '(DRY RUN)'} ===\n`);

const { getMsGraphToken } = await import('@/lib/shared-services/it-mdm');
const { createServiceRoleClient } = await import('@/lib/supabase/persist-client');
const { getEmployee, updateEmployee } = await import('@/lib/hris/employees');
const { getRunWithSteps, updateStepStatus } = await import('@/lib/hris/runs');

const sb = createServiceRoleClient();

// --- 1. Entra user (Josh completed in Admin Center) -------------------------
const tok = await getMsGraphToken();
if (!tok.ok) throw new Error(`Graph token unavailable: ${tok.detail}`);

const entraRes = await fetch(
  `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(ACCESS_EMAIL)}?$select=id,userPrincipalName,mail,displayName,accountEnabled`,
  { headers: { Authorization: `Bearer ${tok.token}` } },
);
const entra = await entraRes.json();
if (!entraRes.ok) {
  throw new Error(`Entra lookup failed: ${entraRes.status} ${JSON.stringify(entra).slice(0, 300)}`);
}
say(`entra UPN   : ${entra.userPrincipalName}`);
say(`entra id    : ${entra.id}`);
say(`entra mail  : ${entra.mail}`);
say(`enabled     : ${entra.accountEnabled}`);

if ((entra.userPrincipalName ?? '').toLowerCase() !== ACCESS_EMAIL) {
  throw new Error(`UPN mismatch — expected ${ACCESS_EMAIL}, got ${entra.userPrincipalName}`);
}

// --- 2. Onboarding run + ms_email step --------------------------------------
const empRes = await getEmployee(EMPLOYEE_ID);
if (!empRes.employee) throw new Error('HRIS employee not found');
say(`\nHRIS work_email: ${empRes.employee.work_email} · status=${empRes.employee.status}`);

const { data: runs } = await sb
  .from('os_hris_process_runs')
  .select('id, run_key, kind, status')
  .eq('employee_id', EMPLOYEE_ID)
  .eq('kind', 'onboarding')
  .in('status', ['open', 'in_progress', 'blocked'])
  .order('created_at', { ascending: false })
  .limit(1);

const runId = runs?.[0]?.id as string | undefined;
if (!runId) throw new Error('No open onboarding run for Kelly');
say(`onboarding run: ${runs![0].run_key} (${runId})`);

const runFull = await getRunWithSteps(runId);
const msStep = runFull.run?.steps?.find((s) => s.step_key === 'bs.ms_email');
const inviteStep = runFull.run?.steps?.find((s) => s.step_key === 'bs.hris_invite');
if (!msStep) throw new Error('bs.ms_email step missing on run');
say(`bs.ms_email   : ${msStep.status} (id ${msStep.id})`);
if (inviteStep) say(`bs.hris_invite: ${inviteStep.status} (id ${inviteStep.id})`);

// --- 3. Supabase auth + profile (shared across all 4 OS on opdqybaatfbwkokbzwli) ---
let authUserId: string | null = null;
const list = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
const match = list.data.users.find((u) => (u.email ?? '').toLowerCase() === ACCESS_EMAIL);
authUserId = match?.id ?? null;
say(`\nauth user     : ${authUserId ?? '(none yet)'}`);

if (!authUserId) {
  say(`${tag}create auth.users for ${ACCESS_EMAIL} (email_confirm, no password — Microsoft OAuth)`);
  if (APPLY) {
    const created = await sb.auth.admin.createUser({
      email: ACCESS_EMAIL,
      email_confirm: true,
      user_metadata: {
        full_name: FULL_NAME,
        role: ROLE,
        entity_id: ENTITY,
        provisioned_by: 'hris:kelly-hipskind-onboard',
      },
    });
    if (created.error) throw new Error(`auth create failed: ${created.error.message}`);
    authUserId = created.data.user?.id ?? null;
    say(`   created id ${authUserId}`);
  }
} else if (APPLY) {
  const upd = await sb.auth.admin.updateUserById(authUserId, {
    email: ACCESS_EMAIL,
    email_confirm: true,
    user_metadata: {
      full_name: FULL_NAME,
      role: ROLE,
      entity_id: ENTITY,
    },
  });
  if (upd.error) say(`   auth update warn: ${upd.error.message}`);
  else say('auth.users metadata refreshed');
}

if (!authUserId && !APPLY) {
  authUserId = '00000000-0000-0000-0000-000000000001';
}

if (!authUserId) throw new Error('Could not resolve auth user id');

// --- 4. profiles row ----------------------------------------------------------
const { data: prof } = await sb
  .from('profiles')
  .select('id, email, role, entity_id, active')
  .eq('id', authUserId)
  .maybeSingle();

if (!prof) {
  say(`${tag}insert profiles · role=${ROLE} · entity=${ENTITY}`);
  if (APPLY) {
    const { error } = await sb.from('profiles').insert({
      id: authUserId,
      email: ACCESS_EMAIL,
      full_name: FULL_NAME,
      role: ROLE,
      entity_id: ENTITY,
      active: true,
    });
    if (error) throw new Error(`profiles insert: ${error.message}`);
    say('   ok');
  }
} else {
  say(`profiles      : ${prof.email} · ${prof.role} · ${prof.entity_id} · active=${prof.active}`);
  if (
    prof.role !== ROLE ||
    prof.entity_id !== ENTITY ||
    prof.email?.toLowerCase() !== ACCESS_EMAIL ||
    !prof.active
  ) {
    say(`${tag}update profiles → ${ROLE} / ${ENTITY} / active`);
    if (APPLY) {
      const { error } = await sb
        .from('profiles')
        .update({
          email: ACCESS_EMAIL,
          full_name: FULL_NAME,
          role: ROLE,
          entity_id: ENTITY,
          active: true,
        })
        .eq('id', authUserId);
      if (error) throw new Error(`profiles update: ${error.message}`);
      say('   ok');
    }
  }
}

// --- 5. HRIS identity stamp ---------------------------------------------------
const hrisPatch = {
  work_email: ACCESS_EMAIL,
  upn: ACCESS_EMAIL,
  entra_object_id: entra.id as string,
  profile_id: authUserId,
  identity_status: 'enabled',
};
say(`\n${tag}HRIS identity stamp (profile + Entra)`);
if (APPLY) {
  const r = await updateEmployee(EMPLOYEE_ID, { work_email: ACCESS_EMAIL });
  if (!r.ok) say(`   work_email warn: ${r.error}`);
  const { error } = await sb
    .from('os_hris_employees')
    .update({
      upn: ACCESS_EMAIL,
      entra_object_id: entra.id,
      profile_id: authUserId,
      identity_status: 'enabled',
    })
    .eq('id', EMPLOYEE_ID);
  if (error) throw new Error(`HRIS update: ${error.message}`);
  say('   ok');
}

// --- 6. Check off bs.ms_email (no Graph joiner assist — manual Admin Center) ---
const msEvidence =
  'Microsoft mailbox + UPN created in Microsoft Admin Center (Josh). Entra user verified via Graph; portal auth user linked.';
if (msStep.status !== 'done') {
  say(`\n${tag}mark bs.ms_email → done`);
  if (APPLY) {
    const res = await updateStepStatus({
      step_id: msStep.id,
      status: 'done',
      evidence_note: msEvidence,
      actor_id: null,
    });
    if (!res.ok) throw new Error(`ms_email step: ${res.error}`);
    say(`   ok · run ${res.run.completion_pct}%`);
  }
} else {
  say('\nbs.ms_email already done');
}

// --- 7. Portal invite step (access to OS — sign in with Microsoft) ------------
const portalEvidence =
  'Supabase profile provisioned (COO / ENT-FIRM). Sign in at Tage VC + subsidiary portals with Microsoft using work email.';
if (inviteStep && inviteStep.status !== 'done') {
  say(`${tag}mark bs.hris_invite → done`);
  if (APPLY) {
    const res = await updateStepStatus({
      step_id: inviteStep.id,
      status: 'done',
      evidence_note: portalEvidence,
      actor_id: null,
    });
    if (!res.ok) throw new Error(`hris_invite step: ${res.error}`);
    say(`   ok · run ${res.run.completion_pct}%`);
  }
}

say('\n=== OS access (single login · Microsoft OAuth) ===');
for (const [name, url] of [
  ['Tage VC OS', 'https://app.tagevc.com'],
  ['Recruit 619 OS', 'https://portal.recruit619.com'],
  ['Signent HR OS', 'https://portal.signenthr.com'],
  ['Instant NDA OS', 'https://portal.instantnda.us'],
] as const) {
  say(` · ${name}: ${url} — role ${ROLE}, firm-wide RLS via ENT-FIRM`);
}

say('\nDone.');
