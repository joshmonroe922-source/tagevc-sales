import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { sloSimulationExportRetentionDays } from './slo-policy';

const sql = readFileSync(
  new URL('../../../supabase/phase44_slo_governance_ops.sql', import.meta.url),
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

describe('Phase 44 SLO governance ops', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('adds scenario library, handoff suggestions, and revision ledger', () => {
    expect(sql).toContain('os_slo_simulation_scenarios');
    expect(sql).toContain('register_slo_simulation_scenario_phase44');
    expect(sql).toContain('replay_slo_simulation_scenario_phase44');
    expect(sql).toContain('request_slo_simulation_phase40');
    expect(sql).toContain('production_alerts_mutated');
    expect(sql).toContain('os_slo_owner_handoff_suggestions');
    expect(sql).toContain('suggest_slo_owner_handoffs_phase44');
    expect(sql).toContain('phase40_replacement_eligible');
    expect(sql).toContain('live_succession_mutated');
    expect(sql).toContain('os_slo_policy_revision_ledger');
    expect(sql).toContain('record_slo_policy_revision_phase44');
    expect(sql).toContain('get_slo_phase44_governance_report');
    expect(sql).toContain('list_slo_phase44_critical_windows');
    expect(sql).toContain('os_slo_phase44_ops_alerts');
    expect(sql).toContain('archival_overdue');
    expect(sql).toContain('succession_drill_overdue');
    expect(sql).toContain('owner_expiry_without_handoff');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('phase44_slo_safe_detail');
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('keeps mutation RPCs service-role-only and grants list/report to authenticated', () => {
    expect(sql).toMatch(
      /revoke all on function public\.register_slo_simulation_scenario_phase44[\s\S]*?from public,authenticated/,
    );
    expect(sql).toMatch(
      /revoke all on function public\.suggest_slo_owner_handoffs_phase44\(integer\)[\s\S]*?from public,authenticated/,
    );
    expect(sql).toMatch(
      /public\.suggest_slo_owner_handoffs_phase44\(integer\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.record_slo_policy_revision_phase44\(uuid,uuid,bigint,bigint,text,boolean\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.list_slo_phase44_critical_windows\(integer\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.get_slo_phase44_governance_report\(\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.suggest_slo_owner_handoffs_phase44\([^)]*\)\s*to authenticated/,
    );
  });

  it('wires handoffs, scenarios, and evaluate tick into app surfaces', () => {
    expect(repo).toContain("'suggest_slo_owner_handoffs_phase44'");
    expect(repo).toContain("'register_slo_simulation_scenario_phase44'");
    expect(repo).toContain("'replay_slo_simulation_scenario_phase44'");
    expect(repo).toContain("'record_slo_policy_revision_phase44'");
    expect(repo).toContain('suggestSloOwnerHandoffsPhase44');
    expect(repo).toContain('processSloGovernancePhase44');
    expect(admin).toContain('suggestSloOwnerHandoffsAction');
    expect(admin).toContain('Suggest owner handoffs');
    expect(admin).toContain('Accept suggestion');
    expect(actions).toContain('suggestSloOwnerHandoffsAction');
    expect(actions).toContain('resolveSloOwnerHandoffSuggestionAction');
    expect(actions).toContain('registerSloSimulationScenarioAction');
    expect(evaluateRoute).toContain('processSloGovernancePhase44');
  });

  it('reuses retention env bounds from Phase 42', () => {
    delete process.env.SLO_SIMULATION_EXPORT_RETENTION_DAYS;
    expect(sloSimulationExportRetentionDays()).toBe(90);
    process.env.SLO_SIMULATION_EXPORT_RETENTION_DAYS = '120';
    expect(sloSimulationExportRetentionDays()).toBe(120);
  });
});
