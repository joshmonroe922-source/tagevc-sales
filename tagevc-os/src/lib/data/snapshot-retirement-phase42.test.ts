import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signExternalReceipt } from './snapshot-retirement-phase41';
import { canonicalPackageJson } from './snapshot-retirement-phase40';
import {
  buildOfflineVerifyBundle,
  snapshotColdRetentionCadenceHours,
} from './snapshot-retirement-phase42';

const ORIGINAL_ENV = { ...process.env };

describe('Phase 42 snapshot verify material and cold HEAD ops', () => {
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
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('builds an offline verify bundle with public keys only', () => {
    const canonicalReceiptText = canonicalPackageJson({
      contract_version: 'phase41-v1',
      governance: {
        attestation_eligible: false,
        production_relation_mutated: false,
        qualification_eligible: false,
      },
      retention_tier: 'cold',
    });
    const signed = signExternalReceipt(canonicalReceiptText);
    const bundle = buildOfflineVerifyBundle({
      receipt: {
        canonical_receipt_text: canonicalReceiptText,
        receipt_sha256: createHash('sha256')
          .update(canonicalReceiptText, 'utf8')
          .digest('hex'),
        verify_key_id: signed.keyId,
        receipt_signature: signed.signature,
        retention_tier: 'cold',
      },
    });
    expect(bundle.algorithm).toBe('ed25519');
    expect(bundle.verification.signature_ok).toBe(true);
    expect(bundle.verification.digest_ok).toBe(true);
    expect(bundle.verification.private_key_included).toBe(false);
    expect(bundle.governance.qualification_eligible).toBe(false);
    expect(bundle).not.toHaveProperty('private_key');
    expect(JSON.stringify(bundle)).not.toMatch(/-----BEGIN/);
    expect(Object.keys(bundle).join(',')).not.toMatch(/private_key(?!_included)/);
  });

  it('has zero os_store_snapshots DML/DDL and forces non-qualification', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase42_snapshot_verify_cold_ops.sql'),
      'utf8',
    )
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sql).not.toMatch(
      /\b(insert\s+into|update|delete\s+from|drop\s+(?:table|view)|alter\s+table|truncate(?:\s+table)?|rename\s+(?:table\s+)?)\s+(?:public\.)?os_store_snapshots\b/i,
    );
    expect(sql).not.toContain('os_store_snapshots');
    expect(sql).toContain('os_snapshot_public_verify_material');
    expect(sql).toContain('os_snapshot_cold_retention_check_runs');
    expect(sql).toContain('publish_snapshot_verify_material_phase42');
    expect(sql).toContain('record_snapshot_cold_retention_check_phase42');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('not qualification_eligible and not attestation_eligible');
    expect(sql).not.toMatch(/if\s+case\s+when/i);
    expect(sql).toContain('with (security_invoker=true)');
  });

  it('keeps mutation RPCs service-role-only', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase42_snapshot_verify_cold_ops.sql'),
      'utf8',
    );
    expect(sql).toMatch(
      /revoke all on function public\.publish_snapshot_verify_material_phase42[\s\S]*?from public,authenticated/,
    );
    expect(sql).toMatch(
      /public\.publish_snapshot_verify_material_phase42\(\s*uuid,text,text,text,jsonb\s*\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.record_snapshot_cold_retention_check_phase42\([\s\S]*?\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.get_snapshot_phase42_verify_cold_report\(\)[\s\S]*?to authenticated, service_role/,
    );
  });

  it('defaults cold cadence hours and validates optional env bounds', () => {
    delete process.env.SNAPSHOT_COLD_RETENTION_CHECK_CADENCE_HOURS;
    expect(snapshotColdRetentionCadenceHours()).toBe(168);
    process.env.SNAPSHOT_COLD_RETENTION_CHECK_CADENCE_HOURS = '72';
    expect(snapshotColdRetentionCadenceHours()).toBe(72);
    process.env.SNAPSHOT_COLD_RETENTION_CHECK_CADENCE_HOURS = '12';
    expect(() => snapshotColdRetentionCadenceHours()).toThrow(/24 and 720/);
  });
});
