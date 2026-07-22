import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PHASE46_SNAPSHOT_CONTRACT_VERSION,
  snapshotOncallWebhookUrl,
} from './snapshot-retirement-phase46';

const ORIGINAL_ENV = { ...process.env };

describe('Phase 46 snapshot cutover ops', () => {
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
    delete process.env.SNAPSHOT_ONCALL_WEBHOOK;
    delete process.env.SLO_WEBHOOK_OPS_ALERTS;
    delete process.env.SLO_WEBHOOK_ALLOWED_HOSTS;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('has zero production snapshot-relation mentions and forces non-qualification', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase46_snapshot_cutover_ops.sql'),
      'utf8',
    )
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sql).not.toContain('os_store_snapshots');
    expect(sql).toContain('os_snapshot_ed25519_cutover_acceptances');
    expect(sql).toContain(
      'create table if not exists public.os_snapshot_ed25519_key_rotations',
    );
    expect(sql).toContain('record_snapshot_cutover_acceptance_phase46');
    expect(sql).toContain('complete_snapshot_ed25519_cutover_phase46');
    expect(sql).toContain('complete_snapshot_ed25519_cutover_phase45');
    expect(sql).toContain("'offline_script'");
    expect(sql).toContain("'admin'");
    expect(sql).toContain("'worker'");
    expect(sql).toContain('dual_acceptance_complete');
    expect(sql).toContain('os_snapshot_oncall_page_routes');
    expect(sql).toContain('os_snapshot_oncall_page_deliveries');
    expect(sql).toContain('route_snapshot_oncall_page_phase46');
    expect(sql).toContain('get_snapshot_phase46_ops_report');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('not qualification_eligible and not attestation_eligible');
    expect(sql).toContain('production_relation_mutated');
    expect(sql).toContain('phase46_snapshot_safe_detail');
    expect(sql).not.toMatch(/if\s+case\s+when/i);
    expect(sql).toContain('with (security_invoker=true)');
    expect(sql).toMatch(/before update or delete or truncate/);
  });

  it('keeps mutation RPCs service-role-only and grants report to authenticated', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase46_snapshot_cutover_ops.sql'),
      'utf8',
    );
    expect(sql).toMatch(
      /revoke all on function public\.record_snapshot_cutover_acceptance_phase46[\s\S]*?from public,authenticated/,
    );
    expect(sql).toMatch(
      /public\.record_snapshot_cutover_acceptance_phase46\([\s\S]*?\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.complete_snapshot_ed25519_cutover_phase46\(uuid,uuid\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.route_snapshot_oncall_page_phase46\([\s\S]*?\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.get_snapshot_phase46_ops_report\(\)[\s\S]*?to authenticated, service_role/,
    );
  });

  it('wires phase46 helpers into API, admin UI, and worker without private keys', () => {
    const lib = readFileSync(
      resolve(process.cwd(), 'src/lib/data/snapshot-retirement-phase46.ts'),
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
    expect(lib).toContain('recordSnapshotCutoverAcceptancePhase46');
    expect(lib).toContain('completeSnapshotEd25519CutoverPhase46');
    expect(lib).toContain('pageSnapshotOncallRoutesPhase46');
    expect(lib).toContain('runSnapshotPhase46OpsWorker');
    expect(lib).toContain(PHASE46_SNAPSHOT_CONTRACT_VERSION);
    expect(lib).toContain('SNAPSHOT_ONCALL_WEBHOOK');
    expect(lib).not.toMatch(/PRIVATE_KEY(?!S)/);
    expect(route).toContain('record_cutover_acceptance');
    expect(route).toContain('complete_ed25519_cutover');
    expect(route).toMatch(
      /completeSnapshotEd25519CutoverPhase46|completeSnapshotEd25519CutoverPhase47|completeSnapshotEd25519CutoverPhase48|completeSnapshotEd25519CutoverPhase49|completeSnapshotEd25519CutoverPhase50/,
    );
    expect(route).toMatch(
      /getSnapshotPhase46OpsDashboard|getSnapshotPhase47OpsDashboard|getSnapshotPhase48OpsDashboard|getSnapshotPhase49OpsDashboard|getSnapshotPhase50OpsDashboard/,
    );
    expect(worker).toMatch(
      /runSnapshotPhase46OpsWorker|runSnapshotPhase47OpsWorker|runSnapshotPhase48OpsWorker|runSnapshotPhase49OpsWorker|runSnapshotPhase50OpsWorker/,
    );
    expect(ui).toMatch(/Record cutover acceptance|Record offline_script acceptance/);
    expect(ui).toContain('Complete cutover');
    expect(ui).toContain('phase46Slo');
    expect(ui).not.toMatch(/-----BEGIN/);
  });

  it('resolves on-call webhook via SNAPSHOT_ONCALL_WEBHOOK or ops alerts allowlist', () => {
    process.env.SLO_WEBHOOK_ALLOWED_HOSTS = 'hooks.example.com';
    expect(snapshotOncallWebhookUrl().url).toBeNull();

    process.env.SLO_WEBHOOK_OPS_ALERTS = 'https://hooks.example.com/slo';
    expect(snapshotOncallWebhookUrl()).toEqual({
      url: 'https://hooks.example.com/slo',
      destination_key: 'ops_alerts',
    });

    process.env.SNAPSHOT_ONCALL_WEBHOOK = 'https://hooks.example.com/oncall';
    expect(snapshotOncallWebhookUrl()).toEqual({
      url: 'https://hooks.example.com/oncall',
      destination_key: 'oncall',
    });

    process.env.SNAPSHOT_ONCALL_WEBHOOK = 'http://hooks.example.com/oncall';
    expect(snapshotOncallWebhookUrl().destination_key).toBe('ops_alerts');
  });
});
