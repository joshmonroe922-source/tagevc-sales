import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]),
}));

import {
  inspectRetentionDestination,
  parseRetentionDestinations,
  verifyCanonicalPackageSignature,
} from './snapshot-retirement-phase40';
import { canonicalJson } from './snapshot-retirement-phase39';
import { createHmac } from 'node:crypto';

const ORIGINAL_ENV = { ...process.env };
const ARTIFACT_SHA = 'a'.repeat(64);

describe('Phase 40 snapshot retirement contracts', () => {
  beforeEach(() => {
    delete process.env.SNAPSHOT_EXPORT_HMAC_KEYS;
    process.env.SNAPSHOT_EXPORT_HMAC_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.SNAPSHOT_EXPORT_HMAC_KEY_ID = 'snapshot-export-2026-01';
    process.env.SNAPSHOT_RETENTION_ALLOWED_HOSTS = 'evidence.example.com';
    process.env.SNAPSHOT_RETENTION_DESTINATIONS = JSON.stringify({
      archive_primary: {
        url: 'https://evidence.example.com/object/phase40.json',
        hash_header: 'x-evidence-sha256',
      },
    });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('verifies the server-held HMAC and rejects package tampering', () => {
    const canonicalPackageText = canonicalJson({
      artifact: { sha256: ARTIFACT_SHA },
      contract_version: 'phase40-v1',
    });
    const signature = createHmac(
      'sha256',
      Buffer.from(process.env.SNAPSHOT_EXPORT_HMAC_KEY!, 'base64'),
    )
      .update(canonicalPackageText)
      .digest('hex');
    expect(
      verifyCanonicalPackageSignature({
        canonicalPackageText,
        keyId: 'snapshot-export-2026-01',
        signature,
      }),
    ).toBe(true);
    expect(
      verifyCanonicalPackageSignature({
        canonicalPackageText: `${canonicalPackageText} `,
        keyId: 'snapshot-export-2026-01',
        signature,
      }),
    ).toBe(false);
    expect(
      verifyCanonicalPackageSignature({
        canonicalPackageText,
        keyId: 'wrong-key',
        signature,
      }),
    ).toBe(false);
  });

  it('verifies historical signatures through the server-held keyring', () => {
    const historicalKey = Buffer.alloc(32, 9);
    process.env.SNAPSHOT_EXPORT_HMAC_KEYS = JSON.stringify({
      'snapshot-export-2025-12': historicalKey.toString('base64'),
      'snapshot-export-2026-01': process.env.SNAPSHOT_EXPORT_HMAC_KEY,
    });
    const canonicalPackageText = canonicalJson({
      artifact: { sha256: ARTIFACT_SHA },
      contract_version: 'phase40-v1',
    });
    const signature = createHmac('sha256', historicalKey)
      .update(canonicalPackageText)
      .digest('hex');
    expect(
      verifyCanonicalPackageSignature({
        canonicalPackageText,
        keyId: 'snapshot-export-2025-12',
        signature,
      }),
    ).toBe(true);
  });

  it('requires exact HTTPS allowlists and rejects credential or IP destinations', () => {
    expect(Object.keys(parseRetentionDestinations())).toEqual(['archive_primary']);
    expect(() =>
      parseRetentionDestinations(
        JSON.stringify({ bad: { url: 'http://evidence.example.com/a' } }),
        'evidence.example.com',
      ),
    ).toThrow(/Unsafe/);
    expect(() =>
      parseRetentionDestinations(
        JSON.stringify({ bad: { url: 'https://127.0.0.1/a' } }),
        '127.0.0.1',
      ),
    ).toThrow(/Unsafe/);
    expect(() =>
      parseRetentionDestinations(
        JSON.stringify({ bad: { url: 'https://user:pass@evidence.example.com/a' } }),
        'evidence.example.com',
      ),
    ).toThrow(/Unsafe/);
    expect(() =>
      parseRetentionDestinations(
        JSON.stringify({ bad: { url: 'https://other.example.com/a' } }),
        'evidence.example.com',
      ),
    ).toThrow(/Unsafe/);
  });

  it('uses HEAD only and distinguishes verified, mismatch, missing, and expired', async () => {
    const packageRow = {
      destination_key: 'archive_primary',
      artifact_sha256: ARTIFACT_SHA,
      artifact_size_bytes: 123,
      retained_until: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const verifiedFetch = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect(init?.method).toBe('HEAD');
      expect(init?.redirect).toBe('manual');
      return new Response(null, {
        status: 200,
        headers: {
          'content-length': '123',
          'x-evidence-sha256': ARTIFACT_SHA,
        },
      });
    });
    await expect(
      inspectRetentionDestination(packageRow, verifiedFetch as typeof fetch),
    ).resolves.toMatchObject({ status: 'verified', observedSizeBytes: 123 });

    const mismatchFetch = vi.fn(async () =>
      new Response(null, {
        status: 200,
        headers: {
          'content-length': '123',
          'x-evidence-sha256': 'b'.repeat(64),
        },
      }),
    );
    await expect(
      inspectRetentionDestination(packageRow, mismatchFetch as typeof fetch),
    ).resolves.toMatchObject({
      status: 'hash_mismatch',
      errorCode: 'artifact_hash_mismatch',
    });

    const missingFetch = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(
      inspectRetentionDestination(packageRow, missingFetch as typeof fetch),
    ).resolves.toMatchObject({ status: 'missing' });

    await expect(
      inspectRetentionDestination(
        { ...packageRow, retained_until: new Date(Date.now() - 1000).toISOString() },
        verifiedFetch as typeof fetch,
      ),
    ).resolves.toMatchObject({ status: 'expired' });
  });

  it('has zero snapshot-store DML or DDL and no raw snapshot access', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase40_snapshot_retirement.sql'),
      'utf8',
    )
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sql).not.toMatch(
      /\b(insert\s+into|update|delete\s+from|drop\s+(?:table|view)|alter\s+table|truncate(?:\s+table)?|rename\s+(?:table\s+)?)\s+(?:public\.)?os_store_snapshots\b/i,
    );
    expect(sql).not.toContain('os_store_snapshots');
    expect(sql).not.toMatch(
      /\binsert\s+into\s+(?:public\.)?os_snapshot_(?:drill_runs|soak_observations|rollback_rehearsals|evidence_cycles)\b/i,
    );
    expect(sql).not.toMatch(/\b(?:hmac|signing)_(?:key|secret)\b/i);
  });

  it('enforces immutable evidence, durable fencing, and non-qualification', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase40_snapshot_retirement.sql'),
      'utf8',
    );
    for (const trigger of [
      'os_snapshot_export_packages_immutable',
      'os_snapshot_retention_checks_immutable',
      'os_snapshot_phase40_steps_immutable',
      'os_snapshot_phase40_events_immutable',
    ]) {
      expect(sql).toMatch(
        new RegExp(`${trigger}[\\s\\S]*?before update or delete or truncate`),
      );
    }
    expect(sql).toContain('lease_generation=lease_generation+1');
    expect(sql).toContain("'resumed'");
    expect(sql).toContain("'heartbeat'");
    expect(sql).toContain("'aborted'");
    expect(sql).toContain("'expired'");
    expect(sql).toContain('max_active_runs between 1 and 4');
    expect(sql).toContain('min_duration_minutes>=120');
    expect(sql).toContain('qualification_eligible boolean not null default false');
    expect(sql).toContain('attestation_eligible boolean not null default false');
    expect(sql).toContain("'synthetic_nonqualifying'::text as evidence_class");
    expect(sql).toContain('with (security_invoker=true)');
  });

  it('keeps every Phase 40 mutation behind service-role RPCs', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase40_snapshot_retirement.sql'),
      'utf8',
    );
    for (const rpc of [
      'create_snapshot_export_package_v1',
      'record_snapshot_retention_check_v1',
      'schedule_snapshot_phase40_canary_v1',
      'claim_snapshot_phase40_canaries_v1',
      'heartbeat_snapshot_phase40_canary_v1',
      'record_snapshot_phase40_step_v1',
      'abort_snapshot_phase40_canary_v1',
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `revoke all on function public\\.${rpc}[\\s\\S]*?from public,authenticated`,
        ),
      );
      expect(sql).toMatch(
        new RegExp(`grant execute on function public\\.${rpc}[\\s\\S]*?to service_role`),
      );
    }
    expect(sql).toContain('revoke insert,update,delete,truncate on');
    expect(sql.split('$$')).toHaveLength(
      1 +
        2 *
          (sql.match(/^(?:create or replace function|do \$\$)/gm)?.length ?? 0),
    );
  });
});
