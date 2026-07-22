import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PHASE45_SNAPSHOT_CONTRACT_VERSION,
  snapshotConsecutiveFailureThreshold,
} from './snapshot-retirement-phase45';

const ORIGINAL_ENV = { ...process.env };

describe('Phase 45 snapshot key rotation ops', () => {
  beforeEach(() => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const privateDer = privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer;
    const publicDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    process.env.SNAPSHOT_EXPORT_ED25519_KEY_ID = 'snapshot-ed25519-2026-01';
    process.env.SNAPSHOT_EXPORT_ED25519_PRIVATE_KEY = privateDer.toString('base64');
    process.env.SNAPSHOT_EXPORT_ED25519_PUBLIC_KEY = publicDer.toString('base64');
    process.env.SNAPSHOT_EXPORT_ED25519_PUBLIC_KEYS = JSON.stringify({
      'snapshot-ed25519-2026-01': publicDer.toString('base64'),
      'snapshot-ed25519-2026-07': publicDer.toString('base64'),
    });
    process.env.SNAPSHOT_EXPORT_ED25519_PRIVATE_KEYS = JSON.stringify({
      'snapshot-ed25519-2026-01': privateDer.toString('base64'),
      'snapshot-ed25519-2026-07': privateDer.toString('base64'),
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
      resolve(process.cwd(), 'supabase/phase45_snapshot_key_rotation_ops.sql'),
      'utf8',
    )
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sql).not.toContain('os_store_snapshots');
    expect(sql).toContain('os_snapshot_ed25519_key_rotations');
    expect(sql).toContain('announce_snapshot_ed25519_rotation_phase45');
    expect(sql).toContain('activate_snapshot_dual_key_phase45');
    expect(sql).toContain('complete_snapshot_ed25519_cutover_phase45');
    expect(sql).toContain('status in (');
    expect(sql).toContain("'announced'");
    expect(sql).toContain("'dual_active'");
    expect(sql).toContain("'cutover_complete'");
    expect(sql).toContain("'aborted'");
    expect(sql).toContain('os_snapshot_consecutive_failure_counters');
    expect(sql).toContain('os_snapshot_phase45_ops_alerts');
    expect(sql).toContain('consecutive_cold_head_failures');
    expect(sql).toContain('consecutive_integrity_failures');
    expect(sql).toContain('scan_snapshot_consecutive_failures_phase45');
    expect(sql).toContain('get_snapshot_phase45_ops_report');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('not qualification_eligible and not attestation_eligible');
    expect(sql).toContain('production_relation_mutated');
    expect(sql).toContain('phase45_snapshot_safe_detail');
    expect(sql).not.toMatch(/if\s+case\s+when/i);
    expect(sql).toContain('with (security_invoker=true)');
    expect(sql).toMatch(/before update or delete or truncate/);
  });

  it('keeps mutation RPCs service-role-only and grants list/report to authenticated', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase45_snapshot_key_rotation_ops.sql'),
      'utf8',
    );
    expect(sql).toMatch(
      /revoke all on function public\.announce_snapshot_ed25519_rotation_phase45[\s\S]*?from public,authenticated/,
    );
    expect(sql).toMatch(
      /public\.announce_snapshot_ed25519_rotation_phase45\([\s\S]*?\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.activate_snapshot_dual_key_phase45\(uuid,uuid\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.complete_snapshot_ed25519_cutover_phase45\(uuid,uuid\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.scan_snapshot_consecutive_failures_phase45\(uuid,integer\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.list_snapshot_phase45_ops_alerts\(integer\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.get_snapshot_phase45_ops_report\(\)[\s\S]*?to authenticated, service_role/,
    );
  });

  it('wires phase45 helpers into API, admin UI, and worker without private keys', () => {
    const lib = readFileSync(
      resolve(process.cwd(), 'src/lib/data/snapshot-retirement-phase45.ts'),
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
    expect(lib).toContain('announceSnapshotEd25519RotationPhase45');
    expect(lib).toContain('activateSnapshotDualKeyPhase45');
    expect(lib).toContain('completeSnapshotEd25519CutoverPhase45');
    expect(lib).toContain('pageSnapshotConsecutiveFailuresPhase45');
    expect(lib).toContain('runSnapshotPhase45OpsWorker');
    expect(lib).toContain(PHASE45_SNAPSHOT_CONTRACT_VERSION);
    expect(lib).not.toMatch(/PRIVATE_KEY(?!S)/);
    expect(route).toContain('announce_ed25519_rotation');
    expect(route).toContain('activate_dual_key');
    expect(route).toContain('complete_ed25519_cutover');
    expect(route).toMatch(
      /getSnapshotPhase45OpsDashboard|getSnapshotPhase46OpsDashboard|getSnapshotPhase47OpsDashboard/,
    );
    expect(worker).toMatch(
      /runSnapshotPhase45OpsWorker|runSnapshotPhase46OpsWorker|runSnapshotPhase47OpsWorker/,
    );
    expect(ui).toContain('Announce ed25519 rotation');
    expect(ui).toContain('Activate dual-key');
    expect(ui).toContain('Complete cutover');
    expect(ui).toContain('phase45Slo');
    expect(ui).not.toMatch(/-----BEGIN/);
  });

  it('validates consecutive failure threshold env bounds', () => {
    delete process.env.SNAPSHOT_CONSECUTIVE_FAILURE_THRESHOLD;
    expect(snapshotConsecutiveFailureThreshold()).toBe(3);
    process.env.SNAPSHOT_CONSECUTIVE_FAILURE_THRESHOLD = '5';
    expect(snapshotConsecutiveFailureThreshold()).toBe(5);
    process.env.SNAPSHOT_CONSECUTIVE_FAILURE_THRESHOLD = '200';
    expect(() => snapshotConsecutiveFailureThreshold()).toThrow(/1 and 100/);
  });
});
