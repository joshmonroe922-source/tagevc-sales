import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { sloSimulationExportRetentionDays } from './slo-policy';

const sql = readFileSync(
  new URL(
    '../../../supabase/phase43_slo_export_archival_succession_drills.sql',
    import.meta.url,
  ),
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

describe('Phase 43 SLO export archival and succession drills', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('adds metadata-only archival receipts and soft-hides archived exports', () => {
    expect(sql).toContain('os_slo_simulation_export_archival_receipts');
    expect(sql).toContain('archive_slo_simulation_export_phase43');
    expect(sql).toContain('archive_expired_slo_simulation_exports_phase43');
    expect(sql).toContain('list_slo_simulation_exports_phase43');
    expect(sql).toContain('soft_hidden');
    expect(sql).toContain("'rows_deleted',false");
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).not.toMatch(/delete\s+from\s+public\.os_slo_simulation_exports/i);
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('keeps succession drills distinct from live Phase 42 succession', () => {
    expect(sql).toContain('os_slo_owner_succession_drills');
    expect(sql).toContain('run_slo_owner_succession_drill_phase43');
    expect(sql).toContain('live_succession_mutated');
    expect(sql).toContain('not live_succession_mutated');
    expect(sql).toContain('distinct_from');
    expect(sql).toContain('propose_slo_owner_succession_phase42');
    expect(sql).not.toMatch(
      /run_slo_owner_succession_drill_phase43[\s\S]*update\s+public\.os_slo_owners/i,
    );
    expect(sql).not.toMatch(
      /run_slo_owner_succession_drill_phase43[\s\S]*update\s+public\.os_slo_policies/i,
    );
  });

  it('keeps mutation RPCs service-role-only and grants list/report to authenticated', () => {
    expect(sql).toMatch(
      /revoke all on function public\.archive_slo_simulation_export_phase43[\s\S]*?from public,authenticated/,
    );
    expect(sql).toMatch(
      /public\.archive_expired_slo_simulation_exports_phase43\(uuid,integer\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.run_slo_owner_succession_drill_phase43\(uuid,uuid,text,uuid\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.list_slo_simulation_exports_phase43\(uuid,boolean,boolean,integer\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.get_slo_phase43_archival_drill_report\(\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.run_slo_owner_succession_drill_phase43\([^)]*\)\s*to authenticated/,
    );
  });

  it('wires archival and drills into app surfaces', () => {
    expect(repo).toContain("'archive_expired_slo_simulation_exports_phase43'");
    expect(repo).toContain("'run_slo_owner_succession_drill_phase43'");
    expect(repo).toContain("'list_slo_simulation_exports_phase43'");
    expect(repo).toContain('archiveExpiredSloExportsPhase43');
    expect(repo).toContain('runSloOwnerSuccessionDrillPhase43');
    expect(admin).toContain('archiveExpiredSloExportsAction');
    expect(admin).toContain('runSloOwnerSuccessionDrillAction');
    expect(admin).toContain('Archive expired exports');
    expect(admin).toContain('Run succession drill');
    expect(actions).toContain('archiveExpiredSloExportsAction');
    expect(actions).toContain('runSloOwnerSuccessionDrillAction');
  });

  it('reuses retention env bounds from Phase 42', () => {
    delete process.env.SLO_SIMULATION_EXPORT_RETENTION_DAYS;
    expect(sloSimulationExportRetentionDays()).toBe(90);
    process.env.SLO_SIMULATION_EXPORT_RETENTION_DAYS = '120';
    expect(sloSimulationExportRetentionDays()).toBe(120);
  });
});
