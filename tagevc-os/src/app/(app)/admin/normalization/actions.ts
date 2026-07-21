'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { guardPermission } from '@/lib/rbac/session';
import {
  createSnapshotRollbackRehearsal,
  reviewSnapshotRollbackRehearsal,
} from '@/lib/data/snapshot-rollback-attestations';

export type SnapshotAttestationActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

const sha = z.string().regex(/^[0-9a-f]{64}$/);

export async function createRollbackRehearsalAction(input: {
  epoch_id: string;
  retired_table_name: string;
  config_fingerprint: string;
  artifact_uri: string;
  artifact_sha256: string;
  procedure_sha256: string;
  manifest: Record<string, unknown>;
}): Promise<SnapshotAttestationActionResult> {
  const gate = await guardPermission('action:snapshot_rollback_attest');
  if (!gate.ok) return gate;
  const parsed = z
    .object({
      epoch_id: z.string().uuid(),
      retired_table_name: z
        .string()
        .regex(/^os_store_snapshots_retired_\d{8}$/),
      config_fingerprint: sha,
      artifact_uri: z.string().url().or(z.string().regex(/^(s3|gs):\/\//)),
      artifact_sha256: sha,
      procedure_sha256: sha,
      manifest: z
        .record(z.string(), z.unknown())
        .refine(
          (manifest) => manifest.production_relation_mutated === false,
          'Manifest must state production_relation_mutated=false',
        ),
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message || 'Invalid rehearsal evidence',
    };
  }
  const result = await createSnapshotRollbackRehearsal({
    ...parsed.data,
    actor_id: gate.profile.id,
  });
  if (!result.ok) return result;
  revalidatePath('/admin/normalization');
  return { ok: true, message: 'Operator attestation recorded; reviewer required' };
}

export async function reviewRollbackRehearsalAction(input: {
  drill_run_id: string;
  manifest_sha256: string;
  decision: 'attest' | 'reject';
  statement: string;
  expected_row_version: number;
}): Promise<SnapshotAttestationActionResult> {
  const gate = await guardPermission('action:snapshot_rollback_attest');
  if (!gate.ok) return gate;
  const parsed = z
    .object({
      drill_run_id: z.string().uuid(),
      manifest_sha256: sha,
      decision: z.enum(['attest', 'reject']),
      statement: z.string().trim().min(20).max(1000),
      expected_row_version: z.number().int().nonnegative(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message || 'Invalid review evidence',
    };
  }
  const result = await reviewSnapshotRollbackRehearsal({
    ...parsed.data,
    actor_id: gate.profile.id,
  });
  if (!result.ok) return result;
  revalidatePath('/admin/normalization');
  return { ok: true, message: `Rehearsal ${parsed.data.decision} recorded` };
}
