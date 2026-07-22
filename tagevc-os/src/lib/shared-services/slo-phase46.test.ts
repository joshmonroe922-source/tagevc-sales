import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { sloSimulationExportRetentionDays } from './slo-policy';

const sql = readFileSync(
  new URL('../../../supabase/phase46_slo_governance_ops.sql', import.meta.url),
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

describe('Phase 46 SLO governance ops', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('adds firm-wide replay, digest publications, and ownership-change alerts', () => {
    expect(sql).toContain('os_slo_firm_wide_nightly_replay_schedules');
    expect(sql).toContain('os_slo_firm_wide_nightly_replay_runs');
    expect(sql).toContain('run_slo_firm_wide_nightly_replay_phase46');
    expect(sql).toContain('phase46_scenario_is_firm_wide_claim');
    expect(sql).toContain('replay_slo_simulation_scenario_phase44');
    expect(sql).toContain('production_alerts_mutated');
    expect(sql).toContain('os_slo_owner_handoff_digest_publications');
    expect(sql).toContain('publish_slo_owner_handoff_digest_phase46');
    expect(sql).toContain('generate_slo_owner_handoff_digest_phase45');
    expect(sql).toContain('recipient_count');
    expect(sql).toContain('destination_key');
    expect(sql).toContain('os_slo_ownership_change_alerts');
    expect(sql).toContain('ownership_expiry_without_handoff');
    expect(sql).toContain('get_slo_phase46_governance_report');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('phase46_slo_safe_detail');
    expect(sql).not.toMatch(/email\s+text/i);
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('keeps mutation RPCs service-role-only and grants report to authenticated', () => {
    expect(sql).toMatch(
      /revoke all on function public\.run_slo_firm_wide_nightly_replay_phase46[\s\S]*?from public,authenticated/,
    );
    expect(sql).toMatch(
      /revoke all on function public\.publish_slo_owner_handoff_digest_phase46[\s\S]*?from public,authenticated/,
    );
    expect(sql).toMatch(
      /public\.run_slo_firm_wide_nightly_replay_phase46\(uuid,timestamptz,text\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.publish_slo_owner_handoff_digest_phase46\(uuid,text,text,integer\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.get_slo_phase46_governance_report\(\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.run_slo_firm_wide_nightly_replay_phase46\([^)]*\)\s*to authenticated/,
    );
  });

  it('wires firm-wide replay, publish, and evaluate tick into app surfaces', () => {
    expect(repo).toContain("'run_slo_firm_wide_nightly_replay_phase46'");
    expect(repo).toContain("'publish_slo_owner_handoff_digest_phase46'");
    expect(repo).toContain("'scan_slo_ownership_change_alerts_phase46'");
    expect(repo).toContain('processSloGovernancePhase46');
    expect(repo).toContain('runSloFirmWideNightlyReplayPhase46');
    expect(repo).toContain('publishSloOwnerHandoffDigestPhase46');
    expect(admin).toContain('runSloFirmWideNightlyReplayAction');
    expect(admin).toContain('Run firm-wide nightly replay');
    expect(admin).toContain('publishSloOwnerHandoffDigestAction');
    expect(admin).toContain('Publish handoff digest');
    expect(admin).toContain('phase46Report');
    expect(actions).toContain('runSloFirmWideNightlyReplayAction');
    expect(actions).toContain('publishSloOwnerHandoffDigestAction');
    expect(evaluateRoute).toContain('processSloGovernancePhase46');
    expect(evaluateRoute.indexOf('processSloGovernancePhase45')).toBeLessThan(
      evaluateRoute.indexOf('processSloGovernancePhase46'),
    );
  });

  it('reuses retention env bounds from Phase 42', () => {
    delete process.env.SLO_SIMULATION_EXPORT_RETENTION_DAYS;
    expect(sloSimulationExportRetentionDays()).toBe(90);
    process.env.SLO_SIMULATION_EXPORT_RETENTION_DAYS = '120';
    expect(sloSimulationExportRetentionDays()).toBe(120);
  });
});
