/**
 * Dennis McCall (ENT-R619) — reconcile identity + drive the real HRIS joiner assists.
 *
 * Runs through the platform (`@/lib/hris/*`) rather than hand-rolled Graph calls so the
 * onboarding run, audit trail, and completion percentage all move the way the UI would.
 *
 * Read-only unless --apply is passed.
 *
 *   npm exec --yes tsx@4 -- scripts/dennis-onboard/10-r619-drive.ts
 *   npm exec --yes tsx@4 -- scripts/dennis-onboard/10-r619-drive.ts --apply
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env.local into process.env before importing anything that reads env at module scope.
for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (!m) continue;
  if (process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const APPLY = process.argv.includes('--apply');
const EMPLOYEE_ID = '3d7937db-34f1-4be1-82a6-21e84b2b26a7';
const RUN_ID = '76ec8793-66d8-4a43-bfbe-1710f1054e5e';
const PROFILE_ID = 'f8b5d2a2-cc29-4ec0-adc2-74e714cf0a1b';
const ENTRA_ID = '89fdd120-d221-4953-93a2-fc39a5f46983';
const LIVE_UPN = 'dennis@recruit619.com';

const { getEmployee, updateEmployee } = await import('@/lib/hris/employees');
const { getRunWithSteps, updateStepStatus } = await import('@/lib/hris/runs');
const { dispatchHrisStepAssist } = await import('@/lib/hris/step-assists');
const { createServiceRoleClient } = await import('@/lib/supabase/persist-client');
const { getMsGraphToken } = await import('@/lib/shared-services/it-mdm');

const log: string[] = [];
const say = (s: string) => {
  console.log(s);
  log.push(s);
};
const tag = APPLY ? '' : '[dry-run] ';

say(`=== Dennis McCall · R619 drive ${APPLY ? '(APPLY)' : '(DRY RUN)'} ===\n`);

// ---------------------------------------------------------------- 1. guard rails
const before = await getEmployee(EMPLOYEE_ID);
if (!before.employee) throw new Error(`Employee not found: ${before.error}`);
const emp0 = before.employee;
say(`employee      : ${emp0.full_name} · ${emp0.entity_id} · status=${emp0.status}`);
say(`work_email    : ${emp0.work_email}`);
say(`onboarding    : ${emp0.onboarding_status} ${emp0.onboarding_pct}%`);

if (emp0.entity_id !== 'ENT-R619') {
  throw new Error(`Refusing to run: entity_id is ${emp0.entity_id}, expected ENT-R619`);
}

// ------------------------------------------- 2. work_email must match the live mailbox
// The Graph joiner resolves the existing Entra user by work_email. If work_email points at
// an address that is not on the account, the joiner CREATES a second user and burns another
// licence, so this has to be reconciled before any assist runs.
const staleEmail = emp0.work_email.trim().toLowerCase() !== LIVE_UPN;
if (staleEmail) {
  say(
    `\n!! work_email "${emp0.work_email}" is not the live mailbox (${LIVE_UPN}).` +
      `\n   Left as-is it would make the Graph joiner provision a DUPLICATE user.`,
  );
  say(`${tag}set os_hris_employees.work_email = ${LIVE_UPN}`);
  if (APPLY) {
    const r = await updateEmployee(EMPLOYEE_ID, { work_email: LIVE_UPN });
    say(r.ok ? '   ok' : `   FAILED: ${r.error}`);
  }
} else {
  say(`\nwork_email already matches live mailbox — no change`);
}

// ------------------------------------------------------- 3. HRIS phase -> onboarding
if (emp0.status !== 'onboarding') {
  say(`\n${tag}set status ${emp0.status} -> onboarding`);
  if (APPLY) {
    const r = await updateEmployee(EMPLOYEE_ID, {
      status: 'onboarding',
      onboarding_status: 'in_progress',
    });
    say(r.ok ? `   ok (status=${r.employee.status})` : `   FAILED: ${r.error}`);
  }
} else {
  say(`\nstatus already onboarding`);
}

// ------------------------------------- 4. name sync: profiles + Entra givenName/surname
const sb = createServiceRoleClient();
const { data: prof } = await sb
  .from('profiles')
  .select('id, full_name, email, role, entity_id, active')
  .eq('id', PROFILE_ID)
  .maybeSingle();
say(
  `\nprofile       : ${prof?.full_name} · role=${prof?.role} · ${prof?.entity_id} · active=${prof?.active}`,
);
if (prof?.role !== 'sub_lead' || prof?.entity_id !== 'ENT-R619') {
  say(`!! expected role=sub_lead entity=ENT-R619 — REVIEW (found ${prof?.role}/${prof?.entity_id})`);
}
if (prof && prof.full_name !== 'Dennis McCall') {
  say(`${tag}set profiles.full_name "${prof.full_name}" -> "Dennis McCall"`);
  if (APPLY) {
    const { error } = await sb
      .from('profiles')
      .update({ full_name: 'Dennis McCall' })
      .eq('id', PROFILE_ID);
    say(error ? `   FAILED: ${error.message}` : '   ok');
  }
}

// givenName / surname are not touched by the joiner patch, so set them directly.
const tok = await getMsGraphToken();
if (!tok.ok) {
  say(`\n!! Graph token unavailable: ${tok.detail}`);
} else {
  const cur = await fetch(
    `https://graph.microsoft.com/v1.0/users/${ENTRA_ID}?$select=displayName,givenName,surname`,
    { headers: { Authorization: `Bearer ${tok.token}` } },
  ).then((r) => r.json());
  say(
    `\nentra name    : displayName="${cur.displayName}" givenName=${JSON.stringify(cur.givenName)} surname=${JSON.stringify(cur.surname)}`,
  );
  if (cur.givenName !== 'Dennis' || cur.surname !== 'McCall') {
    say(`${tag}PATCH Entra givenName=Dennis surname=McCall`);
    if (APPLY) {
      const res = await fetch(`https://graph.microsoft.com/v1.0/users/${ENTRA_ID}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tok.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ givenName: 'Dennis', surname: 'McCall' }),
      });
      say(res.ok ? '   ok' : `   FAILED HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  }
}

// --------------------------------------------------------- 5. drive the real assists
const runRes = await getRunWithSteps(RUN_ID);
if (!runRes.run) throw new Error(`Run not found: ${runRes.error}`);
const steps = runRes.run.steps ?? [];
const byKey = new Map(steps.map((s) => [s.step_key, s]));
say(`\nrun           : ${runRes.run.run_key} status=${runRes.run.status} ${runRes.run.completion_pct}%`);

/** Steps with a real handler in dispatchHrisStepAssist that are safe to drive unattended. */
const DRIVE: Array<{ key: string; why: string }> = [
  { key: 'bs.ms_email', why: 'Graph joiner — re-assert name/title/licence/groups on the live user' },
  { key: 'bs.notify_it', why: 'links the IT onboarding child run' },
  { key: 'bs.computer_setup', why: 'links the IT onboarding child run' },
];

for (const item of DRIVE) {
  const step = byKey.get(item.key);
  if (!step) {
    say(`\n- ${item.key}: NOT IN RUN — skipped`);
    continue;
  }
  say(`\n- ${item.key} (${step.status}) — ${item.why}`);
  if (!APPLY) {
    say(`  ${tag}dispatchHrisStepAssist + mark done`);
    continue;
  }
  const assist = await dispatchHrisStepAssist({
    step,
    employeeId: EMPLOYEE_ID,
    actorId: null,
  });
  say(`  assist: handled=${assist.handled} ${assist.detail}`);
  if (assist.requires_confirm) {
    say('  requires human confirm — left as-is');
    continue;
  }
  const upd = await updateStepStatus({
    step_id: step.id,
    status: 'done',
    evidence_note: assist.evidence_note ?? assist.detail,
    evidence_url: assist.evidence_url ?? undefined,
  });
  say(upd.ok ? `  step -> done (run ${upd.run.completion_pct}%)` : `  step FAILED: ${upd.error}`);
}

// ------------------------------------- 6. reconcile steps that are already true in reality
/** Work that is genuinely finished already — record it so progress is not understated. */
const RECONCILE: Array<{ key: string; status: 'done' | 'na'; note: string }> = [
  {
    key: 'bs.hris_invite',
    status: 'done',
    note: 'Welcome email with Tage OS / R619 portal access delivered to dennis@recruit619.com',
  },
];

for (const item of RECONCILE) {
  const step = byKey.get(item.key);
  if (!step) {
    say(`\n- ${item.key}: NOT IN RUN — skipped`);
    continue;
  }
  if (step.status === item.status) {
    say(`\n- ${item.key}: already ${item.status}`);
    continue;
  }
  say(`\n- ${item.key}: ${step.status} -> ${item.status} (${item.note})`);
  if (APPLY) {
    const upd = await updateStepStatus({
      step_id: step.id,
      status: item.status,
      evidence_note: item.note,
    });
    say(upd.ok ? `  ok (run ${upd.run.completion_pct}%)` : `  FAILED: ${upd.error}`);
  }
}

// ------------------------------------------------------------------- 7. final snapshot
const after = await getEmployee(EMPLOYEE_ID);
const runAfter = await getRunWithSteps(RUN_ID);
const counts = (runAfter.run?.steps ?? []).reduce<Record<string, number>>((acc, s) => {
  acc[s.status] = (acc[s.status] ?? 0) + 1;
  return acc;
}, {});
say(`\n=== AFTER ===`);
say(`status        : ${after.employee?.status}`);
say(`work_email    : ${after.employee?.work_email}`);
say(`onboarding    : ${after.employee?.onboarding_status} ${after.employee?.onboarding_pct}%`);
say(`run           : ${runAfter.run?.status} ${runAfter.run?.completion_pct}%`);
say(`steps         : ${JSON.stringify(counts)}`);
