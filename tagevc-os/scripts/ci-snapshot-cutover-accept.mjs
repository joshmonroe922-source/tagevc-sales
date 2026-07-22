#!/usr/bin/env node
/**
 * CI-integrated offline_script dual-acceptance helper for Phase 48 snapshot
 * cutover. Records CI acceptance evidence when SNAPSHOT_CI_CUTOVER_ENABLED is
 * truthy. Public key ids / hashes only — never secret key material.
 *
 * Usage:
 *   SNAPSHOT_CI_CUTOVER_ENABLED=1 \
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   SNAPSHOT_CI_ACTOR_ID=<uuid> \
 *   SNAPSHOT_CI_ROTATION_ID=<uuid> \
 *   SNAPSHOT_CI_PREVIOUS_KEY_ID=... \
 *   SNAPSHOT_CI_NEXT_KEY_ID=... \
 *   SNAPSHOT_CI_RUN_KEY=github:123 \
 *     node scripts/ci-snapshot-cutover-accept.mjs
 *
 * Dry-check mode (no network) when env is incomplete:
 *   node scripts/ci-snapshot-cutover-accept.mjs --check
 */
import { createHash } from 'node:crypto';

const ENABLED = String(process.env.SNAPSHOT_CI_CUTOVER_ENABLED ?? '')
  .trim()
  .toLowerCase();
const CI_ENABLED = ENABLED === '1' || ENABLED === 'true' || ENABLED === 'yes';
const CHECK_ONLY = process.argv.includes('--check');

function die(message) {
  console.error(message);
  process.exit(1);
}

function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) die(`Missing required env ${name}`);
  return value;
}

if (!CI_ENABLED) {
  console.log(
    JSON.stringify({
      ok: true,
      skipped: true,
      reason: 'SNAPSHOT_CI_CUTOVER_ENABLED is not enabled',
      contract_version: 'phase48-v1',
    }),
  );
  process.exit(0);
}

const actorId = process.env.SNAPSHOT_CI_ACTOR_ID?.trim() ?? '';
const rotationId = process.env.SNAPSHOT_CI_ROTATION_ID?.trim() ?? '';
const previousKeyId = process.env.SNAPSHOT_CI_PREVIOUS_KEY_ID?.trim() ?? '';
const nextKeyId = process.env.SNAPSHOT_CI_NEXT_KEY_ID?.trim() ?? '';
const ciRunKey =
  process.env.SNAPSHOT_CI_RUN_KEY?.trim() ||
  process.env.GITHUB_RUN_ID?.trim() ||
  `local:${Date.now()}`;

if (CHECK_ONLY) {
  const ready = Boolean(
    actorId &&
      rotationId &&
      previousKeyId &&
      nextKeyId &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(previousKeyId) &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(nextKeyId) &&
      previousKeyId !== nextKeyId,
  );
  console.log(
    JSON.stringify({
      ok: ready,
      check_only: true,
      snapshot_ci_cutover_enabled: true,
      offline_script_required: true,
      contract_version: 'phase48-v1',
      qualification_eligible: false,
      attestation_eligible: false,
      production_relation_mutated: false,
    }),
  );
  process.exit(ready ? 0 : 2);
}

const supabaseUrl = requireEnv('SUPABASE_URL');
const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
if (!actorId || !rotationId || !previousKeyId || !nextKeyId) {
  die(
    'SNAPSHOT_CI_ACTOR_ID, SNAPSHOT_CI_ROTATION_ID, SNAPSHOT_CI_PREVIOUS_KEY_ID, and SNAPSHOT_CI_NEXT_KEY_ID are required',
  );
}

const acceptanceSha256 = sha256Hex(
  JSON.stringify({
    ci_run_key: ciRunKey,
    contract_version: 'phase48-v1',
    next_key_id: nextKeyId,
    previous_key_id: previousKeyId,
    rotation_id: rotationId,
    verifier_kind: 'offline_script',
  }),
);

const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/record_snapshot_ci_cutover_acceptance_phase48`, {
  method: 'POST',
  headers: {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    'content-type': 'application/json',
    prefer: 'return=representation',
  },
  body: JSON.stringify({
    p_actor_id: actorId,
    p_rotation_id: rotationId,
    p_acceptance_sha256: acceptanceSha256,
    p_ci_run_key: ciRunKey,
    p_detail: {
      ci: true,
      contract_version: 'phase48-v1',
      source: 'ci-snapshot-cutover-accept.mjs',
    },
  }),
});

if (!response.ok) {
  const text = await response.text();
  die(`CI cutover acceptance RPC failed (${response.status}): ${text}`);
}

const payload = await response.json();
console.log(
  JSON.stringify({
    ok: true,
    acceptance: payload,
    offline_script_required: true,
    contract_version: 'phase48-v1',
    qualification_eligible: false,
    attestation_eligible: false,
    production_relation_mutated: false,
  }),
);
