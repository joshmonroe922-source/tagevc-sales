import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PHASE51_SNAPSHOT_CONTRACT_VERSION } from './snapshot-retirement-phase51';

describe('Phase 51 snapshot cutover: required-check evidence, page-failure escalation, soak trend', () => {
  it('never mentions the retired os_store_snapshots identifier', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase51_snapshot_cutover_ops.sql'),
      'utf8',
    );
    expect(sql).not.toContain('os_store_snapshots');
  });

  it('adds page-failure escalations, required-check verifications, and Stage 4e soak trend rollups', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase51_snapshot_cutover_ops.sql'),
      'utf8',
    )
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sql).toContain(
      'create table if not exists public.os_snapshot_phase51_page_failure_escalations',
    );
    expect(sql).toContain(
      'create table if not exists public.os_snapshot_phase51_required_check_verifications',
    );
    expect(sql).toContain(
      'create table if not exists public.os_snapshot_phase51_soak_trend_snapshots',
    );
    expect(sql).toContain('create table if not exists public.os_snapshot_phase51_ops_alerts');
    expect(sql).toContain('escalate_snapshot_phase51_page_delivery_failures');
    expect(sql).toContain('record_snapshot_phase51_required_check_verification');
    expect(sql).toContain('record_snapshot_phase51_soak_trend');
    expect(sql).toContain('list_snapshot_phase51_critical_windows');
    expect(sql).toContain('get_snapshot_phase51_ops_report');
    expect(sql).toContain('phase51_snapshot_safe_detail');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('set search_path = public, extensions');
    expect(sql).toContain("'4e'");
    expect(sql).toContain(
      'not qualification_eligible and not attestation_eligible',
    );
    expect(sql).toContain('production_relation_mutated');
    expect(sql).toContain(PHASE51_SNAPSHOT_CONTRACT_VERSION);
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('only escalates existing Phase 50 page receipts, never mutates Phase 49/50 rows', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase51_snapshot_cutover_ops.sql'),
      'utf8',
    );
    expect(sql).toContain('from public.os_snapshot_phase50_page_receipts r');
    expect(sql).not.toMatch(
      /update\s+public\.os_snapshot_phase49_ops_alerts/i,
    );
    expect(sql).not.toMatch(
      /delete\s+from\s+public\.os_snapshot_phase49_ops_alerts/i,
    );
    expect(sql).not.toMatch(
      /update\s+public\.os_snapshot_phase50_page_receipts/i,
    );
    expect(sql).not.toMatch(
      /delete\s+from\s+public\.os_snapshot_phase50_page_receipts/i,
    );
    // Required-check verification records evidence only — never mutates GitHub
    // branch protection itself (no octokit/GitHub API calls belong in SQL).
    expect(sql).not.toMatch(/branch[_-]?protection.*(update|patch|put)/i);
  });

  it('is append-only, enables RLS, and keeps required-check + soak-trend recording tightly scoped', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase51_snapshot_cutover_ops.sql'),
      'utf8',
    );
    expect(sql).toContain('is append-only');
    expect(sql).toContain(
      'alter table public.os_snapshot_phase51_page_failure_escalations enable row level security',
    );
    expect(sql).toContain(
      'alter table public.os_snapshot_phase51_required_check_verifications enable row level security',
    );
    expect(sql).toContain(
      'alter table public.os_snapshot_phase51_soak_trend_snapshots enable row level security',
    );
    expect(sql).toContain(
      'alter table public.os_snapshot_phase51_ops_alerts enable row level security',
    );
    expect(sql).toMatch(
      /revoke all on function public\.record_snapshot_phase51_required_check_verification\(\s*\n?\s*uuid,text,text,boolean,jsonb\s*\n?\s*\)[\s\S]*?from public,authenticated/,
    );
    expect(sql).toMatch(
      /public\.record_snapshot_phase51_required_check_verification\(\s*\n?\s*uuid,text,text,boolean,jsonb\s*\n?\s*\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.get_snapshot_phase51_ops_report\(\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.escalate_snapshot_phase51_page_delivery_failures\(uuid\)[\s\S]*?to authenticated, service_role/,
    );
  });

  it('raises a critical alert when the required check is not configured, and when a soak trend is declining', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase51_snapshot_cutover_ops.sql'),
      'utf8',
    );
    expect(sql).toMatch(/required_check_missing/);
    expect(sql).toMatch(/soak_trend_declining/);
    expect(sql).toMatch(/page_delivery_escalated/);
    expect(sql).toMatch(/if not p_required then/);
    expect(sql).toMatch(/if v_direction = 'declining' then/);
  });

  it('never sets qualification/attestation/production_relation_mutated to true anywhere', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase51_snapshot_cutover_ops.sql'),
      'utf8',
    );
    expect(sql).not.toMatch(/qualification_eligible['")\s]*(=|,)\s*true/i);
    expect(sql).not.toMatch(/attestation_eligible['")\s]*(=|,)\s*true/i);
    expect(sql).not.toMatch(/production_relation_mutated['")\s]*(=|,)\s*true/i);
  });

  it('wires phase51 helpers into API route, worker, and admin UI', () => {
    const lib = readFileSync(
      resolve(process.cwd(), 'src/lib/data/snapshot-retirement-phase51.ts'),
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

    expect(lib).toContain('getSnapshotPhase51OpsDashboard');
    expect(lib).toContain('runSnapshotPhase51OpsTick');
    expect(lib).toContain('escalateSnapshotPhase51PageDeliveryFailures');
    expect(lib).toContain('recordSnapshotPhase51RequiredCheckVerification');
    expect(lib).toContain('recordSnapshotPhase51SoakTrend');
    expect(lib).toContain(PHASE51_SNAPSHOT_CONTRACT_VERSION);
    expect(lib).not.toMatch(/PRIVATE_KEY/);
    expect(lib).not.toMatch(/-----BEGIN/);

    // Later phases may compose the Phase 51 dashboard indirectly via a
    // wrapping Phase 52+ dashboard getter that itself calls
    // getSnapshotPhase51OpsDashboard internally — accept either wiring.
    expect(route).toMatch(
      /getSnapshotPhase5[1-9]OpsDashboard|getSnapshotPhase[6-9][0-9]OpsDashboard/,
    );
    expect(route).toContain('escalateSnapshotPhase51PageDeliveryFailures');
    expect(route).toContain('recordSnapshotPhase51RequiredCheckVerification');
    expect(route).toContain('recordSnapshotPhase51SoakTrend');
    expect(route).toContain('escalate_phase51_page_failures');
    expect(route).toContain('record_phase51_required_check_verification');
    expect(route).toContain('record_phase51_soak_trend');

    expect(worker).toContain('runSnapshotPhase51OpsTick');

    expect(ui).toContain('phase51Report');
    expect(ui).toContain('phase51SoakTrendSnapshots');
    expect(ui).toContain('phase51PageFailureEscalations');
    expect(ui).toContain('phase51RequiredCheckVerifications');
    expect(ui).toContain('Record Phase 51 soak trend');
    expect(ui).toContain('Escalate Phase 51 page-delivery failures');
    expect(ui).toContain('Record Phase 51 required-check verification');
  });

  it('adds a GitHub Actions workflow that runs the path-guard as a status check on PRs', () => {
    const workflow = readFileSync(
      resolve(process.cwd(), '..', '.github/workflows/snapshot-path-guard.yml'),
      'utf8',
    );
    expect(workflow).toContain('ci-snapshot-phase50-path-guard');
    expect(workflow).toContain('pull_request');
    expect(workflow).toContain('ci-snapshot-phase50-path-guard.mjs');
    expect(workflow).toContain('--check');
  });

  it('the phase50 CI path-guard script pattern still matches phase51 snapshot-retirement files', () => {
    const script = readFileSync(
      resolve(process.cwd(), 'scripts/ci-snapshot-phase50-path-guard.mjs'),
      'utf8',
    );
    expect(script).toContain('CUTOVER_ADJACENT_PATTERN');
    // phase[0-9]+ pattern generically covers phase51 SQL/TS filenames too.
    expect(script).toMatch(/phase\[0-9\]\+/);
    expect(script).not.toMatch(/PRIVATE_KEY/);
    expect(script).not.toMatch(/-----BEGIN/);
  });
});
