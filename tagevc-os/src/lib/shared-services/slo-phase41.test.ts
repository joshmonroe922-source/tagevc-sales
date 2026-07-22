import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../../supabase/phase41_slo_exports_coverage.sql', import.meta.url),
  'utf8',
);
const repo = readFileSync(new URL('./slo-policy.ts', import.meta.url), 'utf8');
const admin = readFileSync(
  new URL('../../components/shared-services/slo-policy-admin.tsx', import.meta.url),
  'utf8',
);

describe('Phase 41 SLO exports and coverage calendar', () => {
  it('exports signed counterfactual metadata digests only', () => {
    expect(sql).toContain('os_slo_simulation_exports');
    expect(sql).toContain('export_slo_simulation_phase41');
    expect(sql).toContain('COUNTERFACTUAL — no production state mutated');
    expect(sql).toContain("signature_algorithm='hmac-sha256'");
    expect(sql).toContain('metadata_digest');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toMatch(/counterfactual and label='COUNTERFACTUAL/);
    expect(sql).not.toMatch(/(?:insert into|update) public\.os_slo_alerts/);
    expect(sql).not.toMatch(/(?:insert into|update) public\.os_slo_delivery/);
  });

  it('exposes a coverage calendar via security-definer wrapper', () => {
    expect(sql).toContain('os_slo_owner_coverage_calendar');
    expect(sql).toContain('with (security_invoker=true)');
    expect(sql).toContain('get_slo_owner_coverage_calendar_phase41');
    expect(sql).toContain('phase40_replacement_eligible');
    expect(sql).toMatch(
      /public\.get_slo_owner_coverage_calendar_phase41\(integer\),?\s*[\s\S]*?to authenticated, service_role/,
    );
  });

  it('keeps mutation RPCs service-role-only and avoids bare CASE in IF', () => {
    expect(sql).toMatch(
      /grant execute on function public\.export_slo_simulation_phase41\(\s*text,uuid,jsonb,text,text,text,text,text,uuid\s*\)\s*to service_role/,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.export_slo_simulation_phase41\([^)]*\)\s*to authenticated/,
    );
    expect(sql).not.toMatch(/if\s+case\s+when/i);
    expect(repo).toContain("'export_slo_simulation_phase41'");
    expect(repo).toContain("'get_slo_owner_coverage_calendar_phase41'");
    expect(repo).toContain('SLO_SIMULATION_EXPORT_HMAC_KEY_ID');
    expect(admin).toContain('exportSloSimulationAction');
    expect(admin).toContain('Owner coverage calendar');
  });
});
