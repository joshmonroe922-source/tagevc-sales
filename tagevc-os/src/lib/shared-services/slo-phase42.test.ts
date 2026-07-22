import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { sloSimulationExportRetentionDays } from './slo-policy';

const sql = readFileSync(
  new URL('../../../supabase/phase42_slo_export_retention_succession.sql', import.meta.url),
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

const ORIGINAL_ENV = { ...process.env };

describe('Phase 42 SLO export retention and succession', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('adds retention fields and append-only audit access', () => {
    expect(sql).toContain('retention_days');
    expect(sql).toContain('retained_until');
    expect(sql).toContain('os_slo_simulation_export_audit_access');
    expect(sql).toContain('list_slo_simulation_exports_phase42');
    expect(sql).toContain('record_slo_export_audit_access_phase42');
    expect(sql).toContain('propose_slo_owner_succession_phase42');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('phase40_replacement_eligible');
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('keeps mutation RPCs service-role-only and grants list to authenticated', () => {
    expect(sql).toContain('list_slo_simulation_exports_phase42(uuid,boolean,integer)');
    expect(sql).toMatch(
      /public\.list_slo_simulation_exports_phase42\(uuid,boolean,integer\),?\s*[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.record_slo_export_audit_access_phase42\(uuid,uuid,text,jsonb\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.propose_slo_owner_succession_phase42\(uuid,uuid,text,uuid\)[\s\S]*?to service_role/,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.propose_slo_owner_succession_phase42\([^)]*\)\s*to authenticated/,
    );
  });

  it('wires retention env, audit access, and succession into app surfaces', () => {
    expect(repo).toContain('SLO_SIMULATION_EXPORT_RETENTION_DAYS');
    expect(repo).toContain("'list_slo_simulation_exports_phase42'");
    expect(repo).toContain("'record_slo_export_audit_access_phase42'");
    expect(repo).toContain("'propose_slo_owner_succession_phase42'");
    expect(repo).toContain('retention_days: retentionDays');
    expect(admin).toContain('proposeSloOwnerSuccessionAction');
    expect(admin).toContain('recordSloExportAuditAccessAction');
    expect(admin).toContain('Propose succession');
    expect(actions).toContain('proposeSloOwnerSuccessionAction');
    expect(actions).toContain('recordSloExportAuditAccessAction');
  });

  it('defaults retention days and validates optional env bounds', () => {
    delete process.env.SLO_SIMULATION_EXPORT_RETENTION_DAYS;
    expect(sloSimulationExportRetentionDays()).toBe(90);
    process.env.SLO_SIMULATION_EXPORT_RETENTION_DAYS = '180';
    expect(sloSimulationExportRetentionDays()).toBe(180);
    process.env.SLO_SIMULATION_EXPORT_RETENTION_DAYS = '10';
    expect(() => sloSimulationExportRetentionDays()).toThrow(/30 and 730/);
  });
});
