import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PHASE52_SNAPSHOT_CONTRACT_VERSION } from './snapshot-retirement-phase52';

describe('Phase 52 snapshot cutover: branch-protection verify + Stage 4e soak', () => {
  it('never mentions the retired os_store_snapshots identifier', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase52_snapshot_cutover_ops.sql'),
      'utf8',
    );
    expect(sql).not.toContain('os_store_snapshots');
  });

  it('adds branch-protection verifications and Stage 4e soak trend continuation', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase52_snapshot_cutover_ops.sql'),
      'utf8',
    )
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sql).toContain(
      'create table if not exists public.os_snapshot_phase52_branch_protection_verifications',
    );
    expect(sql).toContain(
      'create table if not exists public.os_snapshot_phase52_soak_trend_snapshots',
    );
    expect(sql).toContain('create table if not exists public.os_snapshot_phase52_ops_alerts');
    expect(sql).toContain('record_snapshot_phase52_branch_protection_verification');
    expect(sql).toContain('record_snapshot_phase52_soak_trend');
    expect(sql).toContain('list_snapshot_phase52_critical_windows');
    expect(sql).toContain('get_snapshot_phase52_ops_report');
    expect(sql).toContain('phase52_snapshot_safe_detail');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('set search_path = public, extensions');
    expect(sql).toContain("'4e'");
    expect(sql).toContain(
      'not qualification_eligible and not attestation_eligible',
    );
    expect(sql).toContain('production_relation_mutated');
    expect(sql).toContain(PHASE52_SNAPSHOT_CONTRACT_VERSION);
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('records branch-protection evidence only — never mutates GitHub settings', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase52_snapshot_cutover_ops.sql'),
      'utf8',
    );
    expect(sql).not.toMatch(/branch[_-]?protection.*(update|patch|put)/i);
    expect(sql).toMatch(/Never mutates branch protection/);
  });

  it('is append-only, enables RLS, and keeps verification recording tightly scoped', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase52_snapshot_cutover_ops.sql'),
      'utf8',
    );
    expect(sql).toContain('is append-only');
    expect(sql).toContain(
      'alter table public.os_snapshot_phase52_branch_protection_verifications enable row level security',
    );
    expect(sql).toContain(
      'alter table public.os_snapshot_phase52_soak_trend_snapshots enable row level security',
    );
    expect(sql).toMatch(
      /public\.record_snapshot_phase52_branch_protection_verification\(\s*\n?\s*uuid,text,text,boolean,integer,text,jsonb\s*\n?\s*\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.get_snapshot_phase52_ops_report\(\)[\s\S]*?to authenticated, service_role/,
    );
  });

  it('raises alerts when required check missing or soak trend declining', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase52_snapshot_cutover_ops.sql'),
      'utf8',
    );
    expect(sql).toMatch(/branch_protection_check_missing/);
    expect(sql).toMatch(/soak_trend_declining/);
    expect(sql).toMatch(/if not p_required then/);
    expect(sql).toMatch(/if v_direction = 'declining' then/);
  });

  it('never sets qualification/attestation/production_relation_mutated to true anywhere', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase52_snapshot_cutover_ops.sql'),
      'utf8',
    );
    expect(sql).not.toMatch(/qualification_eligible['")\s]*(=|,)\s*true/i);
    expect(sql).not.toMatch(/attestation_eligible['")\s]*(=|,)\s*true/i);
    expect(sql).not.toMatch(/production_relation_mutated['")\s]*(=|,)\s*true/i);
  });

  it('wires phase52 helpers into API route, worker, and admin UI', () => {
    const lib = readFileSync(
      resolve(process.cwd(), 'src/lib/data/snapshot-retirement-phase52.ts'),
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

    expect(lib).toContain('getSnapshotPhase52OpsDashboard');
    expect(lib).toContain('runSnapshotPhase52OpsTick');
    expect(lib).toContain('recordSnapshotPhase52BranchProtectionVerification');
    expect(lib).toContain('recordSnapshotPhase52SoakTrend');
    expect(lib).toContain(PHASE52_SNAPSHOT_CONTRACT_VERSION);
    expect(lib).not.toMatch(/PRIVATE_KEY/);
    expect(lib).not.toMatch(/-----BEGIN/);

    expect(route).toContain('getSnapshotPhase52OpsDashboard');
    expect(route).toContain('recordSnapshotPhase52BranchProtectionVerification');
    expect(route).toContain('recordSnapshotPhase52SoakTrend');
    expect(route).toContain('record_phase52_branch_protection_verification');
    expect(route).toContain('record_phase52_soak_trend');

    expect(worker).toContain('runSnapshotPhase52OpsTick');

    expect(ui).toContain('phase52Report');
    expect(ui).toContain('phase52SoakTrendSnapshots');
    expect(ui).toContain('phase52BranchProtectionVerifications');
    expect(ui).toContain('Record Phase 52 soak trend');
    expect(ui).toContain('Record Phase 52 branch-protection verification');
  });

  it('adds a read-only branch-protection verify script', () => {
    const script = readFileSync(
      resolve(
        process.cwd(),
        'scripts/ci-snapshot-phase52-branch-protection-verify.mjs',
      ),
      'utf8',
    );
    expect(script).toContain('phase52-v1');
    expect(script).toContain('ci-snapshot-phase50-path-guard');
    expect(script).toMatch(/branch.?protection/i);
    expect(script).toContain('record_snapshot_phase52_branch_protection_verification');
    expect(script).not.toMatch(/PRIVATE_KEY/);
    expect(script).not.toMatch(/-----BEGIN/);
    // Read-only: must not PATCH/PUT/DELETE branch protection.
    expect(script).not.toMatch(/\b(PATCH|PUT|DELETE)\b/);
  });

  it('the phase50 CI path-guard script pattern still matches phase52 snapshot-retirement files', () => {
    const script = readFileSync(
      resolve(process.cwd(), 'scripts/ci-snapshot-phase50-path-guard.mjs'),
      'utf8',
    );
    expect(script).toContain('CUTOVER_ADJACENT_PATTERN');
    expect(script).toMatch(/phase\[0-9\]\+/);
  });
});
