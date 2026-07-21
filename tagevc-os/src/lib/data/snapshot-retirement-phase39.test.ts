import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canaryStepOrdinals,
  canonicalJson,
  sha256,
  validateBoundedMetadata,
} from './snapshot-retirement-phase39';

describe('Phase 39 snapshot retirement contracts', () => {
  it('canonicalizes key order before hashing', () => {
    expect(canonicalJson({ z: 1, a: { d: 2, b: 1 } })).toBe(
      '{"a":{"b":1,"d":2},"z":1}',
    );
    expect(sha256({ a: 1, b: 2 })).toBe(sha256({ b: 2, a: 1 }));
  });

  it('rejects raw payload, credential-like, deep, and oversized metadata', () => {
    expect(validateBoundedMetadata({ snapshot_payload: { rows: [] } }).ok).toBe(
      false,
    );
    expect(validateBoundedMetadata({ api_token: 'not-even-a-real-token' }).ok).toBe(
      false,
    );
    expect(validateBoundedMetadata({ note: `Bearer ${'x'.repeat(40)}` }).ok).toBe(
      false,
    );
    expect(validateBoundedMetadata({ note: 'x'.repeat(5000) }).ok).toBe(false);
    expect(validateBoundedMetadata({ note: { raw: 'object' } }).ok).toBe(false);
    expect(validateBoundedMetadata({ purpose: 'governed retirement evidence' })).toEqual(
      { ok: true },
    );
  });

  it('defines exact bounded replay and concurrency outcomes', () => {
    expect(canaryStepOrdinals('replay', 2)).toEqual([1, 2]);
    expect(canaryStepOrdinals('replay', 8)).toEqual([]);
    expect(canaryStepOrdinals('concurrency', 1)).toEqual([]);
    expect(canaryStepOrdinals('concurrency', 8)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it('contains no mutation or DDL statement against the snapshot store', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase39_snapshot_retirement.sql'),
      'utf8',
    )
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sql).not.toMatch(
      /\b(insert\s+into|update|delete\s+from|drop\s+(table|view)|alter\s+table|truncate(?:\s+table)?|rename\s+(?:table\s+)?)\s+(public\.)?os_store_snapshots\b/i,
    );
    expect(sql).not.toMatch(
      /\binsert\s+into\s+(public\.)?os_snapshot_(drill_runs|soak_observations|rollback_rehearsals|evidence_cycles)\b/i,
    );
    expect(sql).toContain('qualification_eligible boolean not null default false');
    expect(sql).toContain('attestation_eligible boolean not null default false');
    expect(sql).toContain('production_relation_mutated boolean not null default false');
    expect(sql).toContain('phase39-atomic-replay:');
    expect(sql).toContain("observed->>'outcome'='inserted'");
    expect(sql).toContain('before update or delete or truncate');
    expect(sql).toContain('security_invoker=true');
    expect(sql).toContain('lease_generation');
    expect(sql).toContain("'synthetic_nonqualifying'::text as evidence_class");
    expect(sql).toContain('phase39_build_snapshot_manifest');
    expect(sql).toContain("'current_evidence_or_validity_changed'");
    expect(sql).toContain('os_snapshot_export_manifest_status');
  });

  it('keeps Phase 39 mutations behind service-role RPCs', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase39_snapshot_retirement.sql'),
      'utf8',
    );
    for (const rpc of [
      'create_snapshot_export_manifest_v1',
      'begin_snapshot_canary_run_v1',
      'record_snapshot_canary_step_v1',
      'finish_snapshot_canary_run_v1',
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
    expect(sql).toContain(
      'from public,authenticated,service_role;',
    );
    expect(sql).toContain(
      'revoke insert,update,delete,truncate on',
    );
    expect(sql.split('$$')).toHaveLength(
      1 +
        2 *
          (sql.match(/^(?:create or replace function|do \$\$)/gm)?.length ?? 0),
    );
  });
});
