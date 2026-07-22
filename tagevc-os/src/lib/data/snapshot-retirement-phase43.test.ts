import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PHASE43_SNAPSHOT_CONTRACT_VERSION,
  snapshotColdRetentionCadenceHours,
} from './snapshot-retirement-phase43';

const ORIGINAL_ENV = { ...process.env };

describe('Phase 43 snapshot firm-wide verify and production cold HEAD', () => {
  beforeEach(() => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const privateDer = privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer;
    const publicDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    process.env.SNAPSHOT_EXPORT_ED25519_KEY_ID = 'snapshot-ed25519-2026-01';
    process.env.SNAPSHOT_EXPORT_ED25519_PRIVATE_KEY = privateDer.toString('base64');
    process.env.SNAPSHOT_EXPORT_ED25519_PUBLIC_KEY = publicDer.toString('base64');
    process.env.SNAPSHOT_EXPORT_ED25519_PUBLIC_KEYS = JSON.stringify({
      'snapshot-ed25519-2026-01': publicDer.toString('base64'),
    });
    process.env.SNAPSHOT_EXPORT_ED25519_PRIVATE_KEYS = JSON.stringify({
      'snapshot-ed25519-2026-01': privateDer.toString('base64'),
    });
    process.env.SNAPSHOT_RETENTION_ALLOWED_HOSTS = 'evidence.example.com';
    process.env.SNAPSHOT_RETENTION_DESTINATIONS = JSON.stringify({
      archive_primary: {
        url: 'https://evidence.example.com/object.json',
        hash_header: 'x-evidence-sha256',
      },
    });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('has zero os_store_snapshots DML/DDL and forces non-qualification', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase43_snapshot_verify_cold_production.sql'),
      'utf8',
    )
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sql).not.toMatch(
      /\b(insert\s+into|update|delete\s+from|drop\s+(?:table|view)|alter\s+table|truncate(?:\s+table)?|rename\s+(?:table\s+)?)\s+(?:public\.)?os_store_snapshots\b/i,
    );
    expect(sql).not.toContain('os_store_snapshots');
    expect(sql).toContain('os_snapshot_firm_wide_verify_catalog');
    expect(sql).toContain('os_snapshot_production_cold_head_schedules');
    expect(sql).toContain('list_snapshot_firm_wide_verify_material_phase43');
    expect(sql).toContain('list_due_cold_packages_phase43');
    expect(sql).toContain('record_snapshot_production_cold_head_schedule_phase43');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('SNAPSHOT_RETENTION_DESTINATIONS');
    expect(sql).toContain('not qualification_eligible and not attestation_eligible');
    expect(sql).toContain('private_key');
    expect(sql).not.toMatch(/if\s+case\s+when/i);
    expect(sql).toContain('with (security_invoker=true)');
  });

  it('keeps mutation RPCs service-role-only and grants catalog/list to authenticated', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase43_snapshot_verify_cold_production.sql'),
      'utf8',
    );
    expect(sql).toMatch(
      /revoke all on function public\.record_snapshot_production_cold_head_schedule_phase43[\s\S]*?from public,authenticated/,
    );
    expect(sql).toMatch(
      /public\.record_snapshot_production_cold_head_schedule_phase43\([\s\S]*?\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.list_snapshot_firm_wide_verify_material_phase43\(integer\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.list_due_cold_packages_phase43\(integer,integer\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.get_snapshot_phase43_verify_cold_report\(\)[\s\S]*?to authenticated, service_role/,
    );
  });

  it('wires phase43 helpers into API and admin UI without private keys', () => {
    const lib = readFileSync(
      resolve(process.cwd(), 'src/lib/data/snapshot-retirement-phase43.ts'),
      'utf8',
    );
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/admin/snapshot-retirement/route.ts'),
      'utf8',
    );
    const ui = readFileSync(
      resolve(process.cwd(), 'src/components/admin/snapshot-retirement-phase40.tsx'),
      'utf8',
    );
    expect(lib).toContain('listFirmWideVerifyMaterialPhase43');
    expect(lib).toContain('runProductionColdHeadCadencePhase43');
    expect(lib).toContain('SNAPSHOT_RETENTION_DESTINATIONS');
    expect(lib).toContain(PHASE43_SNAPSHOT_CONTRACT_VERSION);
    expect(lib).not.toMatch(/PRIVATE_KEY(?!S)/);
    expect(route).toContain('publish_firm_wide_verify');
    expect(route).toContain('check_production_cold_retention');
    expect(route).toMatch(
      /getSnapshotPhase43VerifyColdDashboard|getSnapshotPhase44OpsDashboard|getSnapshotPhase45OpsDashboard|getSnapshotPhase46OpsDashboard|getSnapshotPhase47OpsDashboard|getSnapshotPhase48OpsDashboard|getSnapshotPhase49OpsDashboard/,
    );
    expect(ui).toContain('Publish firm-wide verify');
    expect(ui).toContain('Run production cold HEAD');
    expect(ui).toContain('phase43Slo');
    expect(ui).not.toMatch(/-----BEGIN/);
  });

  it('reuses cold cadence hours env bounds', () => {
    delete process.env.SNAPSHOT_COLD_RETENTION_CHECK_CADENCE_HOURS;
    expect(snapshotColdRetentionCadenceHours()).toBe(168);
    process.env.SNAPSHOT_COLD_RETENTION_CHECK_CADENCE_HOURS = '96';
    expect(snapshotColdRetentionCadenceHours()).toBe(96);
    process.env.SNAPSHOT_COLD_RETENTION_CHECK_CADENCE_HOURS = '12';
    expect(() => snapshotColdRetentionCadenceHours()).toThrow(/24 and 720/);
  });
});
