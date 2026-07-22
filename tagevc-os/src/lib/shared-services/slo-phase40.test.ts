import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../../supabase/phase40_slo_governance.sql', import.meta.url),
  'utf8',
);
const repo = readFileSync(new URL('./slo-policy.ts', import.meta.url), 'utf8');

describe('Phase 40 SLO governance contract', () => {
  it('compares normalized drafts and classifies material risk', () => {
    expect(sql).toContain('os_slo_policy_draft_comparisons');
    expect(sql).toContain('phase40_normalized_policy');
    expect(sql).toMatch(/'material_risk',field in/);
    expect(sql).toContain("'webhook_destination_keys'");
  });

  it('bounds and isolates immutable counterfactual simulation', () => {
    const simulation = sql.slice(sql.indexOf('create table if not exists public.os_slo_simulations'));
    expect(simulation).toMatch(/interval '90 days'/);
    expect(simulation).toMatch(/max_buckets between 1 and 2160/);
    expect(simulation).toMatch(/cardinality\(entity_ids\)<=100/);
    expect(simulation).toMatch(/for update skip locked/);
    expect(simulation).toMatch(/unique\(simulation_id,source_evaluation_id\)/);
    expect(simulation).toMatch(/COUNTERFACTUAL — no production state mutated/);
    expect(simulation).not.toMatch(/(?:insert into|update) public\.os_slo_alerts/);
    expect(simulation).not.toMatch(/(?:insert into|update) public\.os_slo_delivery/);
    expect(sql).toContain('os_slo_evaluations_no_truncate');
    expect(sql).toContain('os_slo_sim_results_no_truncate');
    expect(sql).toContain('os_slo_sim_evidence_no_truncate');
  });

  it('requires maker-checker and continuous eligible owner coverage', () => {
    expect(sql).toMatch(/v\.created_by=p_actor_id[\s\S]*Maker-checker/);
    expect(sql).toMatch(/Published policy must have continuous eligible owner coverage/);
    expect(sql).toMatch(/replacement_owner_id is null[\s\S]*phase39_owner_authorized/);
    expect(sql).toContain('os_slo_owner_coverage_metrics');
    expect(sql).toContain('scan_slo_owner_expiry_phase40');
    expect(sql).toContain('eligible_replacement_named');
    expect(sql).toContain('os_slo_owner_coverage_evidence_no_truncate');
  });

  it('keeps mutation service-role-only and does not introduce URL inputs', () => {
    expect(sql).toMatch(
      /grant execute on function public\.save_slo_policy_draft_phase40[\s\S]*public\.request_slo_simulation_phase40[\s\S]*to service_role/,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.request_slo_simulation_phase40[\s\S]*to authenticated/,
    );
    expect(sql).not.toMatch(/p_(?:url|href|destination)/);
    expect(repo).toContain("'request_slo_simulation_phase40'");
    expect(repo).toContain("'save_slo_policy_draft_phase40'");
    expect(repo).toContain("'publish_slo_policy_draft_phase40'");
  });
});
