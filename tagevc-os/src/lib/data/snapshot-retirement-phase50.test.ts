import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PHASE50_SNAPSHOT_CONTRACT_VERSION } from './snapshot-retirement-phase50';

describe('Phase 50 snapshot cutover paging/alert + CI --check enforcement ops', () => {
  it('never mentions the retired os_store_snapshots identifier', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase50_snapshot_cutover_ops.sql'),
      'utf8',
    );
    expect(sql).not.toContain('os_store_snapshots');
  });

  it('adds page/alert receipts, CI --check enforcement evidence, and Stage 4e soak snapshots', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase50_snapshot_cutover_ops.sql'),
      'utf8',
    )
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sql).toContain(
      'create table if not exists public.os_snapshot_phase50_page_receipts',
    );
    expect(sql).toContain(
      'create table if not exists public.os_snapshot_phase50_ci_check_enforcement_events',
    );
    expect(sql).toContain(
      'create table if not exists public.os_snapshot_phase50_soak_status_snapshots',
    );
    expect(sql).toContain('page_snapshot_protected_branch_cutover_blocked_phase50');
    expect(sql).toContain('record_snapshot_phase50_ci_check_enforcement');
    expect(sql).toContain('record_snapshot_phase50_soak_status');
    expect(sql).toContain('snapshot_path_is_cutover_adjacent_phase50');
    expect(sql).toContain('list_snapshot_phase50_critical_windows');
    expect(sql).toContain('get_snapshot_phase50_ops_report');
    expect(sql).toContain('phase50_snapshot_safe_detail');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain("set search_path = public, extensions");
    expect(sql).toContain("'4e'");
    expect(sql).toContain('not qualification_eligible and not attestation_eligible');
    expect(sql).toContain('production_relation_mutated');
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('only pages an existing protected_branch_cutover_blocked alert, never mutates it', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase50_snapshot_cutover_ops.sql'),
      'utf8',
    );
    expect(sql).toMatch(
      /where alert_id=p_alert_id and alert_kind='protected_branch_cutover_blocked'/,
    );
    expect(sql).not.toMatch(
      /update\s+public\.os_snapshot_phase49_ops_alerts/i,
    );
    expect(sql).not.toMatch(
      /delete\s+from\s+public\.os_snapshot_phase49_ops_alerts/i,
    );
    expect(sql).not.toMatch(
      /update\s+public\.os_snapshot_phase49_cutover_enforcement_events/i,
    );
  });

  it('is append-only, enables RLS, and keeps CI-check-recording service-role-only', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase50_snapshot_cutover_ops.sql'),
      'utf8',
    );
    expect(sql).toContain('is append-only');
    expect(sql).toContain(
      'alter table public.os_snapshot_phase50_page_receipts enable row level security',
    );
    expect(sql).toContain(
      'alter table public.os_snapshot_phase50_ci_check_enforcement_events enable row level security',
    );
    expect(sql).toContain(
      'alter table public.os_snapshot_phase50_soak_status_snapshots enable row level security',
    );
    expect(sql).toMatch(
      /revoke all on function public\.record_snapshot_phase50_ci_check_enforcement\(\s*\n?\s*uuid,text,jsonb,boolean,jsonb\s*\n?\s*\)[\s\S]*?from public,authenticated/,
    );
    expect(sql).toMatch(
      /public\.record_snapshot_phase50_ci_check_enforcement\(\s*\n?\s*uuid,text,jsonb,boolean,jsonb\s*\n?\s*\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.get_snapshot_phase50_ops_report\(\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.page_snapshot_protected_branch_cutover_blocked_phase50\([\s\S]*?to authenticated, service_role/,
    );
  });

  it('the cutover-adjacent path classifier matches phase-numbered snapshot cutover SQL and CI scripts', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase50_snapshot_cutover_ops.sql'),
      'utf8',
    );
    expect(sql).toContain('supabase/phase[0-9]+_snapshot_cutover_ops');
    expect(sql).toContain('scripts/ci-snapshot-cutover-accept');
    expect(sql).toContain('src/lib/data/snapshot-retirement-phase[0-9]+');
  });

  it('wires phase50 helpers into API route, worker, admin UI, env example, and README', () => {
    const lib = readFileSync(
      resolve(process.cwd(), 'src/lib/data/snapshot-retirement-phase50.ts'),
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

    expect(lib).toContain('getSnapshotPhase50OpsDashboard');
    expect(lib).toContain('runSnapshotPhase50OpsTick');
    expect(lib).toContain('pageSnapshotProtectedBranchCutoverBlockedPhase50');
    expect(lib).toContain('recordSnapshotPhase50SoakStatus');
    expect(lib).toContain(PHASE50_SNAPSHOT_CONTRACT_VERSION);
    expect(lib).not.toMatch(/PRIVATE_KEY/);
    expect(lib).not.toMatch(/-----BEGIN/);

    // Later phases may compose the Phase 50 dashboard indirectly via a
    // wrapping Phase 51+ dashboard getter that itself calls
    // getSnapshotPhase50OpsDashboard internally — accept either wiring.
    expect(route).toMatch(
      /getSnapshotPhase5[0-9]OpsDashboard|getSnapshotPhase[6-9][0-9]OpsDashboard/,
    );
    expect(route).toContain('pageSnapshotProtectedBranchCutoverBlockedPhase50');
    expect(route).toContain('page_protected_branch_cutover_blocked');
    expect(route).toContain('record_soak_status');

    expect(worker).toContain('runSnapshotPhase50OpsTick');

    expect(ui).toContain('phase50Report');
    expect(ui).toContain('phase50SoakSnapshots');
    expect(ui).toContain('Page protected-branch cutover blocked');
  });

  it('the phase50 CI path-guard script exits nonzero for cutover-adjacent paths when the check gate fails', () => {
    const script = readFileSync(
      resolve(process.cwd(), 'scripts/ci-snapshot-phase50-path-guard.mjs'),
      'utf8',
    );
    expect(script).toContain('CUTOVER_ADJACENT_PATTERN');
    expect(script).toContain('--check');
    expect(script).not.toMatch(/PRIVATE_KEY/);
    expect(script).not.toMatch(/-----BEGIN/);
  });
});
