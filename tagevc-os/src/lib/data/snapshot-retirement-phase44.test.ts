import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PHASE44_SNAPSHOT_CONTRACT_VERSION,
  snapshotPhase44CanaryCadenceHours,
} from './snapshot-retirement-phase44';

const ORIGINAL_ENV = { ...process.env };

describe('Phase 44 snapshot retention ops', () => {
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

  it('has zero production snapshot-relation mentions and forces non-qualification', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase44_snapshot_retention_ops.sql'),
      'utf8',
    )
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sql).not.toContain('os_store_snapshots');
    expect(sql).toContain('os_snapshot_package_integrity_checks');
    expect(sql).toContain('verify_snapshot_export_package_integrity_phase44');
    expect(sql).toContain('os_snapshot_retention_ops_alerts');
    expect(sql).toContain('cold_head_failed');
    expect(sql).toContain('cold_head_partial');
    expect(sql).toContain('hash_mismatch');
    expect(sql).toContain('destination_missing');
    expect(sql).toContain('package_expired_unverified');
    expect(sql).toContain('canary_failed');
    expect(sql).toContain('os_snapshot_phase44_canary_schedules');
    expect(sql).toContain('schedule_snapshot_phase44_canary_ops');
    expect(sql).toContain('list_due_phase44_canary_schedules');
    expect(sql).toContain('get_snapshot_phase44_ops_report');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('not qualification_eligible and not attestation_eligible');
    expect(sql).toContain('production_relation_mutated');
    expect(sql).toContain('phase44_snapshot_safe_detail');
    expect(sql).not.toMatch(/if\s+case\s+when/i);
    expect(sql).toContain('with (security_invoker=true)');
    expect(sql).toMatch(/before update or delete or truncate/);
  });

  it('keeps mutation RPCs service-role-only and grants list/report to authenticated', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase44_snapshot_retention_ops.sql'),
      'utf8',
    );
    expect(sql).toMatch(
      /revoke all on function public\.verify_snapshot_export_package_integrity_phase44[\s\S]*?from public,authenticated/,
    );
    expect(sql).toMatch(
      /public\.verify_snapshot_export_package_integrity_phase44\([\s\S]*?\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.schedule_snapshot_phase44_canary_ops\([\s\S]*?\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.list_due_phase44_canary_schedules\(integer\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.list_snapshot_retention_ops_alerts_phase44\(integer\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.get_snapshot_phase44_ops_report\(\)[\s\S]*?to authenticated, service_role/,
    );
  });

  it('wires phase44 helpers into API, admin UI, and worker without private keys', () => {
    const lib = readFileSync(
      resolve(process.cwd(), 'src/lib/data/snapshot-retirement-phase44.ts'),
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
    expect(lib).toContain('verifySnapshotExportPackageIntegrityPhase44');
    expect(lib).toContain('scheduleSnapshotPhase44CanaryOps');
    expect(lib).toContain('runSnapshotPhase44CanaryWorker');
    expect(lib).toContain(PHASE44_SNAPSHOT_CONTRACT_VERSION);
    expect(lib).not.toMatch(/PRIVATE_KEY(?!S)/);
    expect(route).toContain('verify_package_integrity');
    expect(route).toContain('schedule_phase44_canary');
    expect(route).toMatch(
      /getSnapshotPhase45OpsDashboard|getSnapshotPhase46OpsDashboard|getSnapshotPhase47OpsDashboard|getSnapshotPhase48OpsDashboard|getSnapshotPhase49OpsDashboard|getSnapshotPhase50OpsDashboard/,
    );
    expect(worker).toMatch(
      /runSnapshotPhase45OpsWorker|runSnapshotPhase46OpsWorker|runSnapshotPhase47OpsWorker|runSnapshotPhase48OpsWorker|runSnapshotPhase49OpsWorker|runSnapshotPhase50OpsWorker/,
    );
    expect(ui).toContain('Verify package integrity');
    expect(ui).toContain('Schedule Phase 44 canary');
    expect(ui).toContain('phase44Slo');
    expect(ui).not.toMatch(/-----BEGIN/);
  });

  it('validates Phase 44 canary cadence hours env bounds', () => {
    delete process.env.SNAPSHOT_PHASE44_CANARY_CADENCE_HOURS;
    expect(snapshotPhase44CanaryCadenceHours()).toBe(6);
    process.env.SNAPSHOT_PHASE44_CANARY_CADENCE_HOURS = '12';
    expect(snapshotPhase44CanaryCadenceHours()).toBe(12);
    process.env.SNAPSHOT_PHASE44_CANARY_CADENCE_HOURS = '200';
    expect(() => snapshotPhase44CanaryCadenceHours()).toThrow(/1 and 168/);
  });
});
