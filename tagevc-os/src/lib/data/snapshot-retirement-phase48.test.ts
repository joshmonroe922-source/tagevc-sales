import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PHASE48_SNAPSHOT_CONTRACT_VERSION,
  snapshotCiCutoverEnabled,
} from './snapshot-retirement-phase48';

const ORIGINAL_ENV = { ...process.env };

describe('Phase 48 snapshot cutover ops', () => {
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
    delete process.env.SNAPSHOT_CI_CUTOVER_ENABLED;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('has zero production snapshot-relation mentions and enforces CI offline_script dual acceptance', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase48_snapshot_cutover_ops.sql'),
      'utf8',
    )
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sql).not.toContain('os_store_snapshots');
    expect(sql).toContain(
      'create table if not exists public.os_snapshot_ed25519_key_rotations',
    );
    expect(sql).toContain(
      'create table if not exists public.os_snapshot_ed25519_cutover_acceptances',
    );
    expect(sql).toContain('os_snapshot_ci_cutover_acceptances');
    expect(sql).toContain('record_snapshot_ci_cutover_acceptance_phase48');
    expect(sql).toContain('snapshot_cutover_ci_offline_script_dual_acceptance_phase48');
    expect(sql).toContain('complete_snapshot_ed25519_cutover_phase48');
    expect(sql).toContain('complete_snapshot_ed25519_cutover_phase47');
    expect(sql).toContain("'offline_script'");
    expect(sql).toContain('os_snapshot_oncall_ack_slo_dashboards');
    expect(sql).toContain('scan_snapshot_oncall_ack_slo_dashboards_phase48');
    expect(sql).toContain('get_snapshot_phase48_ops_report');
    expect(sql).toContain('not qualification_eligible and not attestation_eligible');
    expect(sql).toContain('production_relation_mutated');
    expect(sql).toContain('phase48_snapshot_safe_detail');
    expect(sql).not.toMatch(/if\s+case\s+when/i);
    expect(sql).toContain('with (security_invoker=true)');
  });

  it('keeps mutation RPCs service-role-only and grants report to authenticated', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase48_snapshot_cutover_ops.sql'),
      'utf8',
    );
    expect(sql).toMatch(
      /revoke all on function public\.complete_snapshot_ed25519_cutover_phase48\(uuid,uuid\)[\s\S]*?from public,authenticated/,
    );
    expect(sql).toMatch(
      /public\.complete_snapshot_ed25519_cutover_phase48\(uuid,uuid\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.record_snapshot_ci_cutover_acceptance_phase48\([\s\S]*?\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.scan_snapshot_oncall_ack_slo_dashboards_phase48\([\s\S]*?\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.get_snapshot_phase48_ops_report\(\)[\s\S]*?to authenticated, service_role/,
    );
  });

  it('wires phase48 helpers into API, admin UI, CI script, and worker without private keys', () => {
    const lib = readFileSync(
      resolve(process.cwd(), 'src/lib/data/snapshot-retirement-phase48.ts'),
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
    const script = readFileSync(
      resolve(process.cwd(), 'scripts/ci-snapshot-cutover-accept.mjs'),
      'utf8',
    );
    const envExample = readFileSync(
      resolve(process.cwd(), '.env.example'),
      'utf8',
    );
    expect(lib).toContain('completeSnapshotEd25519CutoverPhase48');
    expect(lib).toContain('recordSnapshotCiCutoverAcceptancePhase48');
    expect(lib).toContain('scanSnapshotOncallAckSloDashboardsPhase48');
    expect(lib).toContain('runSnapshotPhase48OpsWorker');
    expect(lib).toContain(PHASE48_SNAPSHOT_CONTRACT_VERSION);
    expect(lib).toContain('SNAPSHOT_CI_CUTOVER_ENABLED');
    expect(lib).not.toMatch(/PRIVATE_KEY(?!S)/);
    expect(route).toMatch(
      /completeSnapshotEd25519CutoverPhase48|completeSnapshotEd25519CutoverPhase49|completeSnapshotEd25519CutoverPhase50/,
    );
    expect(route).toMatch(
      /getSnapshotPhase48OpsDashboard|getSnapshotPhase49OpsDashboard|getSnapshotPhase50OpsDashboard/,
    );
    expect(route).toContain('record_ci_cutover_acceptance');
    expect(route).toContain('offline_script');
    expect(worker).toMatch(
      /runSnapshotPhase48OpsWorker|runSnapshotPhase49OpsWorker|runSnapshotPhase50OpsWorker/,
    );
    expect(ui).toContain('phase48Slo');
    expect(ui).toContain('Record CI cutover acceptance');
    expect(ui).toContain('Scan on-call ack dashboards');
    expect(ui).toContain('oncallAckDashboards');
    expect(ui).not.toMatch(/-----BEGIN/);
    expect(script).toContain('SNAPSHOT_CI_CUTOVER_ENABLED');
    expect(script).toContain('record_snapshot_ci_cutover_acceptance_phase48');
    expect(script).toContain('offline_script');
    expect(script).not.toMatch(/PRIVATE_KEY/);
    expect(envExample).toContain('SNAPSHOT_CI_CUTOVER_ENABLED');
  });

  it('defaults SNAPSHOT_CI_CUTOVER_ENABLED to false', () => {
    expect(snapshotCiCutoverEnabled()).toBe(false);
    process.env.SNAPSHOT_CI_CUTOVER_ENABLED = '1';
    expect(snapshotCiCutoverEnabled()).toBe(true);
    process.env.SNAPSHOT_CI_CUTOVER_ENABLED = 'true';
    expect(snapshotCiCutoverEnabled()).toBe(true);
  });
});
