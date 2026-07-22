#!/usr/bin/env node
/**
 * Phase 50: enforces that any PR/run touching "cutover-adjacent" paths
 * (Phase N snapshot-cutover SQL, the CI cutover-accept script family, or the
 * TS snapshot-retirement-phaseN libs) has run the CI offline_script
 * dual-acceptance `--check` gate (scripts/ci-snapshot-cutover-accept.mjs
 * --check) successfully. Non-cutover-adjacent PRs are unaffected.
 *
 * This mirrors the read-only classifier in
 * public.snapshot_path_is_cutover_adjacent_phase50(text) in
 * supabase/phase50_snapshot_cutover_ops.sql — keep the two patterns in sync.
 *
 * Usage:
 *   node scripts/ci-snapshot-phase50-path-guard.mjs --check <<'EOF'
 *   supabase/phase50_snapshot_cutover_ops.sql
 *   src/app/page.tsx
 *   EOF
 *
 * Or supply paths via --paths (comma-separated) instead of stdin:
 *   node scripts/ci-snapshot-phase50-path-guard.mjs --check \
 *     --paths supabase/phase50_snapshot_cutover_ops.sql,src/app/page.tsx
 *
 * Exit codes: 0 = ok (not cutover-adjacent, or --check passed upstream);
 * 2 = cutover-adjacent paths touched and the CI --check gate did not pass;
 * 1 = usage/invocation error.
 *
 * When SNAPSHOT_CI_CHECK_EXIT_CODE is set (0/2 from a prior invocation of
 * `ci-snapshot-cutover-accept.mjs --check` in the same CI job), this script
 * uses it directly instead of re-invoking that script.
 *
 * Optionally records non-qualifying evidence via
 * record_snapshot_phase50_ci_check_enforcement when SUPABASE_URL /
 * SUPABASE_SERVICE_ROLE_KEY are present (best-effort; never blocks on
 * evidence-recording failure — only on the actual gate).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CONTRACT_VERSION = 'phase50-v1';
const CHECK_ONLY = process.argv.includes('--check');

const CUTOVER_ADJACENT_PATTERN = new RegExp(
  [
    '(^|/)supabase/phase[0-9]+_snapshot_cutover_ops\\.sql$',
    '(^|/)scripts/ci-snapshot-cutover-accept(-[a-z0-9-]+)?\\.mjs$',
    '(^|/)scripts/ci-snapshot-phase50-path-guard\\.mjs$',
    '(^|/)src/lib/data/snapshot-retirement-phase[0-9]+\\.ts$',
  ].join('|'),
  'i',
);

function readPathsArg() {
  const idx = process.argv.indexOf('--paths');
  if (idx === -1) return null;
  const raw = process.argv[idx + 1] ?? '';
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function readPathsFromBaseRef() {
  const idx = process.argv.indexOf('--base');
  if (idx === -1) return null;
  const base = process.argv[idx + 1];
  if (!base) return null;
  const result = spawnSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  return result.stdout.split('\n').map((value) => value.trim()).filter(Boolean);
}

function readPathsFromStdin() {
  if (process.stdin.isTTY) return [];
  try {
    const raw = readFileSync(0, 'utf8');
    return raw.split('\n').map((value) => value.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

const changedPaths =
  readPathsArg() ?? readPathsFromBaseRef() ?? readPathsFromStdin();

const matched = changedPaths.filter((path) => CUTOVER_ADJACENT_PATTERN.test(path));
const cutoverAdjacent = matched.length > 0;

function emit(payload, exitCode) {
  console.log(JSON.stringify(payload));
  process.exit(exitCode);
}

if (!cutoverAdjacent) {
  emit(
    {
      ok: true,
      cutover_adjacent: false,
      changed_paths_scanned: changedPaths.length,
      contract_version: CONTRACT_VERSION,
      qualification_eligible: false,
      attestation_eligible: false,
      production_relation_mutated: false,
    },
    0,
  );
}

if (!CHECK_ONLY) {
  emit(
    {
      ok: true,
      skipped: true,
      reason: 'Pass --check to enforce the gate for cutover-adjacent paths',
      cutover_adjacent: true,
      paths_matched: matched,
      contract_version: CONTRACT_VERSION,
    },
    0,
  );
}

let checkExitCode = Number.parseInt(
  process.env.SNAPSHOT_CI_CHECK_EXIT_CODE ?? '',
  10,
);
if (!Number.isFinite(checkExitCode)) {
  const result = spawnSync(
    process.execPath,
    [new URL('./ci-snapshot-cutover-accept.mjs', import.meta.url).pathname, '--check'],
    { encoding: 'utf8' },
  );
  checkExitCode = result.status ?? 1;
}

const checkPassed = checkExitCode === 0;

emit(
  {
    ok: checkPassed,
    cutover_adjacent: true,
    paths_matched: matched,
    ci_check_passed: checkPassed,
    offline_script_required: true,
    contract_version: CONTRACT_VERSION,
    qualification_eligible: false,
    attestation_eligible: false,
    production_relation_mutated: false,
    error: checkPassed
      ? undefined
      : 'CI offline_script dual acceptance --check did not pass for a cutover-adjacent PR (Phase 50 enforcement)',
  },
  checkPassed ? 0 : 2,
);
