import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  signExternalReceipt,
  verifyExternalReceiptSignature,
} from './snapshot-retirement-phase41';
import { canonicalPackageJson } from './snapshot-retirement-phase40';

const ORIGINAL_ENV = { ...process.env };

describe('Phase 41 snapshot external receipts and cold tiers', () => {
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

  it('signs and verifies ed25519 external receipts with public verify keys', () => {
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
    expect(signed.algorithm).toBe('ed25519');
    expect(signed.signature).toMatch(/^[0-9a-f]{128}$/);
    expect(
      verifyExternalReceiptSignature({
        canonicalReceiptText,
        keyId: signed.keyId,
        signature: signed.signature,
      }),
    ).toBe(true);
    expect(
      verifyExternalReceiptSignature({
        canonicalReceiptText: `${canonicalReceiptText} `,
        keyId: signed.keyId,
        signature: signed.signature,
      }),
    ).toBe(false);
  });

  it('has zero os_store_snapshots DML/DDL and forces non-qualification', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase41_snapshot_external_receipts.sql'),
      'utf8',
    )
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sql).not.toMatch(
      /\b(insert\s+into|update|delete\s+from|drop\s+(?:table|view)|alter\s+table|truncate(?:\s+table)?|rename\s+(?:table\s+)?)\s+(?:public\.)?os_store_snapshots\b/i,
    );
    expect(sql).not.toContain('os_store_snapshots');
    expect(sql).toContain("retention_tier in ('warm','cold')");
    expect(sql).toContain("signature_algorithm='ed25519'");
    expect(sql).toContain('qualification_eligible boolean not null default false');
    expect(sql).toContain('not qualification_eligible and not attestation_eligible');
    expect(sql).toContain('create_snapshot_external_receipt_v1');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).not.toMatch(/if\s+case\s+when/i);
    expect(sql).toContain('with (security_invoker=true)');
    expect(sql).toContain('get_snapshot_phase41_receipt_slo');
  });

  it('keeps receipt mutation RPCs service-role-only', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase41_snapshot_external_receipts.sql'),
      'utf8',
    );
    expect(sql).toMatch(
      /revoke all on function public\.create_snapshot_external_receipt_v1[\s\S]*?from public,authenticated/,
    );
    expect(sql).toMatch(
      /public\.create_snapshot_external_receipt_v1\(\s*uuid,uuid,text,jsonb,text,text,text,text,text,text\s*\)[\s\S]*?to service_role/,
    );
    expect(sql).toContain('get_snapshot_phase41_receipt_slo()');
    expect(sql).toMatch(
      /public\.get_snapshot_phase41_receipt_slo\(\)[\s\S]*?to authenticated, service_role/,
    );
  });
});
