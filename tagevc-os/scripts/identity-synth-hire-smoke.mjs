#!/usr/bin/env node
/**
 * Synthetic hire → outbox/worker smoke for identity dual-path.
 * Default: dry-run (no entity cutover / CREATE_USERS). Never prints secrets.
 *
 * Usage:
 *   node scripts/identity-synth-hire-smoke.mjs
 *   IDENTITY_SMOKE_LIVE=1 node scripts/identity-synth-hire-smoke.mjs  # only if Graph live gates on
 *
 * Requires DIGEST_SECRET or CRON_SECRET and IDENTITY_SMOKE_BASE_URL (default local).
 */

const base = (process.env.IDENTITY_SMOKE_BASE_URL || 'http://127.0.0.1:3000').replace(
  /\/$/,
  '',
);
const secret =
  process.env.DIGEST_SECRET ||
  process.env.CRON_SECRET ||
  process.env.HRIS_EVENT_SECRET ||
  '';

const entityId = process.env.IDENTITY_SMOKE_ENTITY || 'ENT-FIRM';
const ownership =
  process.env.IDENTITY_SMOKE_OWNERSHIP === 'personal_byod'
    ? 'personal_byod'
    : 'company_owned';

if (!secret) {
  console.error('Missing DIGEST_SECRET / CRON_SECRET / HRIS_EVENT_SECRET');
  process.exit(1);
}

const stamp = Date.now().toString(36);
const employeeId = `00000000-0000-4000-8000-${stamp.padStart(12, '0').slice(-12)}`;
const payload = {
  event_type: 'hris.employee.hired',
  entity_id: entityId,
  auto_drain: true,
  payload: {
    employee_id: employeeId,
    entity_id: entityId,
    legal_first_name: 'Synth',
    legal_last_name: `Hire${stamp.slice(-4)}`,
    preferred_name: `Synth Hire ${stamp.slice(-4)}`,
    work_email: `synth.hire.${stamp}@tagevc.com`,
    job_title: 'Identity Smoke',
    start_date: new Date().toISOString().slice(0, 10),
    device_ownership: ownership,
    country: 'US',
  },
};

async function main() {
  console.log(
    JSON.stringify({
      phase: 'publish',
      entity_id: entityId,
      employee_id: employeeId,
      device_ownership: ownership,
      live_hint: process.env.IDENTITY_SMOKE_LIVE === '1',
    }),
  );

  const res = await fetch(`${base}/api/identity/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  console.log(
    JSON.stringify({
      http: res.status,
      ok: json.ok === true,
      case_id: json.case_id ?? json.drain?.results?.[0]?.case_id ?? null,
      correlation_id: json.correlation_id ?? null,
      error: json.error ?? null,
    }),
  );
  if (!res.ok || json.ok === false) process.exit(2);
  console.log('smoke publish+drain completed (check UDL entra_user_create audit)');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
