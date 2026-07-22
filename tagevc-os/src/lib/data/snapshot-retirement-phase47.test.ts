import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PHASE47_SNAPSHOT_CONTRACT_VERSION,
  snapshotOncallAckSloMinutes,
} from './snapshot-retirement-phase47';

const ORIGINAL_ENV = { ...process.env };

describe('Phase 47 snapshot cutover ops', () => {
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
    delete process.env.SNAPSHOT_ONCALL_ACK_SLO_MINUTES;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('has zero production snapshot-relation mentions and forces offline_script dual acceptance', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase47_snapshot_cutover_ops.sql'),
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
    expect(sql).toContain('complete_snapshot_ed25519_cutover_phase47');
    expect(sql).toContain('complete_snapshot_ed25519_cutover_phase46');
    expect(sql).toContain('snapshot_cutover_offline_script_dual_acceptance_phase47');
    expect(sql).toContain("'offline_script'");
    expect(sql).toContain('os_snapshot_oncall_ack_slo_snapshots');
    expect(sql).toContain('ack_within_minutes');
    expect(sql).toContain('record_snapshot_oncall_ack_phase47');
    expect(sql).toContain('scan_snapshot_oncall_ack_slo_phase47');
    expect(sql).toContain('consecutive_ack_overdue');
    expect(sql).toContain('get_snapshot_phase47_ops_report');
    expect(sql).toContain('not qualification_eligible and not attestation_eligible');
    expect(sql).toContain('production_relation_mutated');
    expect(sql).toContain('phase47_snapshot_safe_detail');
    expect(sql).not.toMatch(/if\s+case\s+when/i);
    expect(sql).toContain('with (security_invoker=true)');
  });

  it('keeps mutation RPCs service-role-only and grants report to authenticated', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase47_snapshot_cutover_ops.sql'),
      'utf8',
    );
    expect(sql).toMatch(
      /revoke all on function public\.complete_snapshot_ed25519_cutover_phase47\(uuid,uuid\)[\s\S]*?from public,authenticated/,
    );
    expect(sql).toMatch(
      /public\.complete_snapshot_ed25519_cutover_phase47\(uuid,uuid\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.record_snapshot_oncall_ack_phase47\([\s\S]*?\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.scan_snapshot_oncall_ack_slo_phase47\([\s\S]*?\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.get_snapshot_phase47_ops_report\(\)[\s\S]*?to authenticated, service_role/,
    );
  });

  it('wires phase47 helpers into API, admin UI, and worker without private keys', () => {
    const lib = readFileSync(
      resolve(process.cwd(), 'src/lib/data/snapshot-retirement-phase47.ts'),
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
    expect(lib).toContain('completeSnapshotEd25519CutoverPhase47');
    expect(lib).toContain('recordSnapshotOncallAckPhase47');
    expect(lib).toContain('scanSnapshotOncallAckSloPhase47');
    expect(lib).toContain('runSnapshotPhase47OpsWorker');
    expect(lib).toContain(PHASE47_SNAPSHOT_CONTRACT_VERSION);
    expect(lib).toContain('SNAPSHOT_ONCALL_ACK_SLO_MINUTES');
    expect(lib).not.toMatch(/PRIVATE_KEY(?!S)/);
    expect(route).toMatch(
      /completeSnapshotEd25519CutoverPhase47|completeSnapshotEd25519CutoverPhase48|completeSnapshotEd25519CutoverPhase49|completeSnapshotEd25519CutoverPhase50/,
    );
    expect(route).toMatch(
      /getSnapshotPhase47OpsDashboard|getSnapshotPhase48OpsDashboard|getSnapshotPhase49OpsDashboard|getSnapshotPhase50OpsDashboard/,
    );
    expect(route).toContain('offline_script');
    expect(worker).toMatch(
      /runSnapshotPhase47OpsWorker|runSnapshotPhase48OpsWorker|runSnapshotPhase49OpsWorker|runSnapshotPhase50OpsWorker/,
    );
    expect(ui).toContain('offline_script');
    expect(ui).toContain('phase47Slo');
    expect(ui).not.toMatch(/-----BEGIN/);
  });

  it('defaults SNAPSHOT_ONCALL_ACK_SLO_MINUTES to 60', () => {
    expect(snapshotOncallAckSloMinutes()).toBe(60);
    process.env.SNAPSHOT_ONCALL_ACK_SLO_MINUTES = '15';
    expect(snapshotOncallAckSloMinutes()).toBe(15);
    process.env.SNAPSHOT_ONCALL_ACK_SLO_MINUTES = '99999';
    expect(snapshotOncallAckSloMinutes()).toBe(10_080);
  });
});
