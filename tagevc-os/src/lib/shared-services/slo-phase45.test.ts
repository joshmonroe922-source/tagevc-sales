import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { sloSimulationExportRetentionDays } from './slo-policy';

const sql = readFileSync(
  new URL('../../../supabase/phase45_slo_governance_ops.sql', import.meta.url),
  'utf8',
);
const repo = readFileSync(new URL('./slo-policy.ts', import.meta.url), 'utf8');
const admin = readFileSync(
  new URL('../../components/shared-services/slo-policy-admin.tsx', import.meta.url),
  'utf8',
);
const actions = readFileSync(
  new URL('../../app/(app)/shared-services/actions.ts', import.meta.url),
  'utf8',
);
const evaluateRoute = readFileSync(
  new URL('../../app/api/ops/slo-evaluate/route.ts', import.meta.url),
  'utf8',
);

const ORIGINAL_ENV = { ...process.env };

describe('Phase 45 SLO governance ops', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('adds nightly replay, handoff digests, and ownership visibility', () => {
    expect(sql).toContain('os_slo_nightly_scenario_replay_runs');
    expect(sql).toContain('enqueue_slo_nightly_scenario_replay_phase45');
    expect(sql).toContain('run_slo_nightly_scenario_replay_phase45');
    expect(sql).toContain('replay_slo_simulation_scenario_phase44');
    expect(sql).toContain('production_alerts_mutated');
    expect(sql).toContain('os_slo_owner_handoff_digests');
    expect(sql).toContain('generate_slo_owner_handoff_digest_phase45');
    expect(sql).toContain('get_slo_phase45_governance_report');
    expect(sql).toContain('upcoming_ownership_changes');
    expect(sql).toContain('os_slo_phase45_ops_alerts');
    expect(sql).toContain('nightly_replay_failed');
    expect(sql).toContain('handoff_digest_overdue');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('phase45_slo_safe_detail');
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('keeps mutation RPCs service-role-only and grants report to authenticated', () => {
    expect(sql).toMatch(
      /revoke all on function public\.run_slo_nightly_scenario_replay_phase45[\s\S]*?from public,authenticated/,
    );
    expect(sql).toMatch(
      /revoke all on function public\.generate_slo_owner_handoff_digest_phase45[\s\S]*?from public,authenticated/,
    );
    expect(sql).toMatch(
      /public\.run_slo_nightly_scenario_replay_phase45\(uuid,integer,timestamptz\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.generate_slo_owner_handoff_digest_phase45\(uuid,text\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.get_slo_phase45_governance_report\(\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.run_slo_nightly_scenario_replay_phase45\([^)]*\)\s*to authenticated/,
    );
  });

  it('wires nightly replay, digests, and evaluate tick into app surfaces', () => {
    expect(repo).toContain("'run_slo_nightly_scenario_replay_phase45'");
    expect(repo).toContain("'generate_slo_owner_handoff_digest_phase45'");
    expect(repo).toContain("'scan_slo_phase45_ops_alerts'");
    expect(repo).toContain('processSloGovernancePhase45');
    expect(repo).toContain('runSloNightlyScenarioReplayPhase45');
    expect(repo).toContain('generateSloOwnerHandoffDigestPhase45');
    expect(admin).toContain('runSloNightlyScenarioReplayAction');
    expect(admin).toContain('Run nightly scenario replay');
    expect(admin).toContain('generateSloOwnerHandoffDigestAction');
    expect(admin).toContain('Generate handoff digest');
    expect(admin).toContain('phase45Report');
    expect(actions).toContain('runSloNightlyScenarioReplayAction');
    expect(actions).toContain('generateSloOwnerHandoffDigestAction');
    expect(evaluateRoute).toContain('processSloGovernancePhase45');
    expect(evaluateRoute.indexOf('processSloGovernancePhase44')).toBeLessThan(
      evaluateRoute.indexOf('processSloGovernancePhase45'),
    );
  });

  it('reuses retention env bounds from Phase 42', () => {
    delete process.env.SLO_SIMULATION_EXPORT_RETENTION_DAYS;
    expect(sloSimulationExportRetentionDays()).toBe(90);
    process.env.SLO_SIMULATION_EXPORT_RETENTION_DAYS = '120';
    expect(sloSimulationExportRetentionDays()).toBe(120);
  });
});
