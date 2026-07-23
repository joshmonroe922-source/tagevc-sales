#!/usr/bin/env node
/**
 * Phase 52: read-only GitHub branch-protection verification for whether
 * `ci-snapshot-phase50-path-guard` is configured as a REQUIRED status check
 * on the protected branch (default `main`).
 *
 * This script NEVER mutates branch protection — it only performs GET requests
 * against the GitHub REST API. Making the check actually required is a
 * one-time human repo-admin action: Settings → Branches → Branch protection
 * rules → Require status checks to pass → add `ci-snapshot-phase50-path-guard`.
 *
 * Usage:
 *   GITHUB_TOKEN=... node scripts/ci-snapshot-phase52-branch-protection-verify.mjs
 *
 * Check-only mode (exit 0 when required=true, 1 otherwise; no Supabase write):
 *   GITHUB_TOKEN=... node scripts/ci-snapshot-phase52-branch-protection-verify.mjs --check
 *
 * With evidence recording (best-effort; never blocks on RPC failure in --check):
 *   GITHUB_TOKEN=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/ci-snapshot-phase52-branch-protection-verify.mjs
 *
 * Env:
 *   GITHUB_TOKEN or GH_TOKEN — read-only repo scope for branch protection GET
 *   GITHUB_REPOSITORY — owner/repo (defaults from GITHUB_OWNER + GITHUB_REPO)
 *   SNAPSHOT_PHASE52_PROTECTED_BRANCH — branch to inspect (default main)
 *   SNAPSHOT_PHASE52_CHECK_CONTEXT — status check context (default
 *     ci-snapshot-phase50-path-guard)
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — optional evidence recording
 */
const CONTRACT_VERSION = 'phase52-v1';
const CHECK_ONLY = process.argv.includes('--check');

const token = (
  process.env.GITHUB_TOKEN?.trim() ||
  process.env.GH_TOKEN?.trim() ||
  ''
);
const branch = (
  process.env.SNAPSHOT_PHASE52_PROTECTED_BRANCH?.trim() ||
  process.env.GITHUB_REF_NAME?.trim() ||
  'main'
).toLowerCase();
const checkContext =
  process.env.SNAPSHOT_PHASE52_CHECK_CONTEXT?.trim() ||
  'ci-snapshot-phase50-path-guard';

function resolveRepository() {
  const combined = process.env.GITHUB_REPOSITORY?.trim();
  if (combined?.includes('/')) {
    const [owner, repo] = combined.split('/', 2);
    if (owner && repo) return { owner, repo };
  }
  const owner = process.env.GITHUB_OWNER?.trim() ?? '';
  const repo = process.env.GITHUB_REPO?.trim() ?? '';
  if (owner && repo) return { owner, repo };
  return null;
}

function emit(payload, exitCode) {
  console.log(JSON.stringify(payload));
  process.exit(exitCode);
}

async function fetchRequiredStatusChecks(owner, repo, branchName) {
  const url =
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
    `/branches/${encodeURIComponent(branchName)}/protection/required_status_checks`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'tagevc-os-ci-snapshot-phase52-branch-protection-verify',
    },
  });

  if (response.status === 404) {
    return {
      ok: true,
      protection_enabled: false,
      required: false,
      contexts: [],
      contexts_count: 0,
      detail: { http_status: 404, reason: 'branch_protection_or_checks_not_configured' },
    };
  }

  if (!response.ok) {
    const text = await response.text();
    return {
      ok: false,
      error: `GitHub branch-protection GET failed (${response.status}): ${text}`,
    };
  }

  const body = await response.json();
  const contexts = Array.isArray(body.contexts) ? body.contexts : [];
  const required = contexts.includes(checkContext);

  return {
    ok: true,
    protection_enabled: true,
    required,
    contexts,
    contexts_count: contexts.length,
    detail: {
      strict: Boolean(body.strict),
      contexts_url: body.contexts_url ?? null,
    },
  };
}

async function recordVerification(input) {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) {
    return { ok: false, skipped: true, reason: 'supabase_env_missing' };
  }

  const response = await fetch(
    `${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/record_snapshot_phase52_branch_protection_verification`,
    {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify({
        p_actor_id: null,
        p_branch_name: input.branchName,
        p_check_context: input.checkContext,
        p_required: input.required,
        p_contexts_count: input.contextsCount,
        p_source: 'script',
        p_detail: {
          contract_version: CONTRACT_VERSION,
          source: 'ci-snapshot-phase52-branch-protection-verify.mjs',
          protection_enabled: input.protectionEnabled,
          ...input.detail,
        },
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    return {
      ok: false,
      error: `Supabase RPC failed (${response.status}): ${text}`,
    };
  }

  const verification = await response.json();
  return { ok: true, verification };
}

if (!token) {
  emit(
    {
      ok: false,
      error: 'GITHUB_TOKEN or GH_TOKEN is required for read-only branch-protection GET',
      contract_version: CONTRACT_VERSION,
    },
    1,
  );
}

const repository = resolveRepository();
if (!repository) {
  emit(
    {
      ok: false,
      error:
        'GITHUB_REPOSITORY (owner/repo) or GITHUB_OWNER + GITHUB_REPO is required',
      contract_version: CONTRACT_VERSION,
    },
    1,
  );
}

const protection = await fetchRequiredStatusChecks(
  repository.owner,
  repository.repo,
  branch,
);

if (!protection.ok) {
  emit(
    {
      ok: false,
      error: protection.error,
      branch,
      check_context: checkContext,
      contract_version: CONTRACT_VERSION,
    },
    1,
  );
}

const payload = {
  ok: true,
  branch,
  check_context: checkContext,
  required: protection.required,
  protection_enabled: protection.protection_enabled,
  contexts_count: protection.contexts_count,
  contract_version: CONTRACT_VERSION,
  qualification_eligible: false,
  attestation_eligible: false,
  production_relation_mutated: false,
};

if (CHECK_ONLY) {
  emit(
    {
      ...payload,
      check_only: true,
      detail: protection.detail,
    },
    protection.required ? 0 : 1,
  );
}

const recorded = await recordVerification({
  branchName: branch,
  checkContext,
  required: protection.required,
  contextsCount: protection.contexts_count,
  protectionEnabled: protection.protection_enabled,
  detail: protection.detail ?? {},
});

emit(
  {
    ...payload,
    verification_recorded: recorded.ok,
    verification: recorded.verification ?? null,
    recording_error: recorded.error,
    recording_skipped: recorded.skipped ?? false,
    detail: protection.detail,
  },
  protection.required ? 0 : 1,
);
