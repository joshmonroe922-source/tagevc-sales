import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PHASE49_SNAPSHOT_CONTRACT_VERSION,
  snapshotCiProtectedBranchesRequired,
} from './snapshot-retirement-phase49';

const ORIGINAL_ENV = { ...process.env };

describe('Phase 49 snapshot cutover enforcement ops', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('never mentions the retired os_store_snapshots identifier', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase49_snapshot_cutover_ops.sql'),
      'utf8',
    );
    expect(sql).not.toContain('os_store_snapshots');
  });

  it('requires CI offline_script dual acceptance on every protected-branch cutover', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase49_snapshot_cutover_ops.sql'),
      'utf8',
    )
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sql).toContain(
      'create table if not exists public.os_snapshot_phase49_protected_branch_policies',
    );
    expect(sql).toContain(
      'create table if not exists public.os_snapshot_phase49_cutover_enforcement_events',
    );
    expect(sql).toContain('snapshot_branch_is_protected_phase49');
    expect(sql).toContain('complete_snapshot_ed25519_cutover_phase49');
    expect(sql).toContain(
      'snapshot_cutover_ci_offline_script_dual_acceptance_phase48',
    );
    expect(sql).toContain('complete_snapshot_ed25519_cutover_phase48');
    expect(sql).toContain('complete_snapshot_ed25519_cutover_phase47');
    expect(sql).toContain('list_snapshot_phase49_critical_windows');
    expect(sql).toContain('get_snapshot_phase49_ops_report');
    expect(sql).toContain('phase49_snapshot_safe_detail');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain("'main'");
    expect(sql).toContain("'production'");
    expect(sql).toContain('not qualification_eligible and not attestation_eligible');
    expect(sql).toContain('production_relation_mutated');
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('is append-only, enables RLS, and keeps enforcement RPC service-role-only', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase49_snapshot_cutover_ops.sql'),
      'utf8',
    );
    expect(sql).toContain('is append-only');
    expect(sql).toContain(
      'alter table public.os_snapshot_phase49_protected_branch_policies enable row level security',
    );
    expect(sql).toContain(
      'alter table public.os_snapshot_phase49_cutover_enforcement_events enable row level security',
    );
    expect(sql).toMatch(
      /revoke all on function public\.complete_snapshot_ed25519_cutover_phase49\(uuid,uuid,text\)[\s\S]*?from public,authenticated/,
    );
    expect(sql).toMatch(
      /public\.complete_snapshot_ed25519_cutover_phase49\(uuid,uuid,text\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.get_snapshot_phase49_ops_report\(\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.list_snapshot_phase49_critical_windows\(integer\)[\s\S]*?to authenticated, service_role/,
    );
  });

  it('wires phase49 helpers into API route, worker, admin UI, CI script, and env example', () => {
    const lib = readFileSync(
      resolve(process.cwd(), 'src/lib/data/snapshot-retirement-phase49.ts'),
      'utf8',
    );
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/admin/snapshot-retirement/route.ts'),
      'utf8',
    );
    const worker = readFileSync(
      resolve(
        process.cwd(),
        'src/app/api/admin/snapshot-retirement-worker/route.ts',
      ),
      'utf8',
    );
    const ui = readFileSync(
      resolve(process.cwd(), 'src/components/admin/snapshot-retirement-phase40.tsx'),
      'utf8',
    );
    const script = readFileSync(
      resolve(process.cwd(), 'scripts/ci-snapshot-cutover-accept.mjs'),
      'utf8',
    );
    const envExample = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8');

    expect(lib).toContain('completeSnapshotEd25519CutoverPhase49');
    expect(lib).toContain('getSnapshotPhase49OpsDashboard');
    expect(lib).toContain('runSnapshotPhase49OpsWorker');
    expect(lib).toContain(PHASE49_SNAPSHOT_CONTRACT_VERSION);
    expect(lib).not.toMatch(/PRIVATE_KEY/);

    expect(route).toContain('completeSnapshotEd25519CutoverPhase49');
    expect(route).toContain('getSnapshotPhase49OpsDashboard');
    expect(route).toContain('branch');

    expect(worker).toContain('runSnapshotPhase49OpsWorker');

    expect(ui).toContain('phase49Slo');
    expect(ui).toContain('cutoverEnforcementEvents');
    expect(ui).toContain('protected branch');
    expect(ui).not.toMatch(/-----BEGIN/);

    expect(script).toContain('SNAPSHOT_CI_PROTECTED_BRANCH_REQUIRED');
    expect(script).toContain('protected_branch');
    expect(script).not.toMatch(/PRIVATE_KEY/);

    expect(envExample).toContain('SNAPSHOT_CI_PROTECTED_BRANCH_REQUIRED');
  });

  it('CI script fails closed (does not silently skip) on protected branches when disabled', () => {
    const script = readFileSync(
      resolve(process.cwd(), 'scripts/ci-snapshot-cutover-accept.mjs'),
      'utf8',
    );
    expect(script).toMatch(/isProtectedBranch/);
    expect(script).toMatch(/die\(/);
    // The protected-branch failure path must run before the "skipped" success path.
    const protectedFailureIndex = script.indexOf('must be set for cutovers on protected branch');
    const skippedIndex = script.indexOf("reason: 'SNAPSHOT_CI_CUTOVER_ENABLED is not enabled'");
    expect(protectedFailureIndex).toBeGreaterThan(-1);
    expect(skippedIndex).toBeGreaterThan(-1);
    expect(protectedFailureIndex).toBeLessThan(skippedIndex);
  });

  it('defaults protected branches to main and production', () => {
    delete process.env.SNAPSHOT_CI_PROTECTED_BRANCH_REQUIRED;
    expect(snapshotCiProtectedBranchesRequired()).toEqual(['main', 'production']);
    process.env.SNAPSHOT_CI_PROTECTED_BRANCH_REQUIRED = 'main, release/2026';
    expect(snapshotCiProtectedBranchesRequired()).toEqual(['main', 'release/2026']);
  });
});
