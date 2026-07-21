import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createSnapshotExportManifest,
  runSnapshotRetirementCanary,
} from '@/lib/data/snapshot-retirement-phase39';
import { captureException } from '@/lib/observability';
import { guardPermission } from '@/lib/rbac/session';

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$/)
  .refine((value) => !/[A-Za-z0-9_-]{80,}/.test(value), {
    message: 'Idempotency key resembles credential material',
  });

const requestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create_manifest'),
    entity_id: z.string().trim().min(1).max(100).nullable().optional(),
    idempotency_key: idempotencyKeySchema,
    valid_until: z.iso.datetime(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  }),
  z
    .object({
      action: z.literal('run_canary'),
      entity_id: z.string().trim().min(1).max(100).nullable().optional(),
      kind: z.enum(['replay', 'concurrency']),
      idempotency_key: idempotencyKeySchema,
      duration_seconds: z.number().int().min(1).max(300),
      concurrency: z.number().int().min(2).max(8),
    })
    .superRefine((value, context) => {
      if (value.kind === 'replay' && value.concurrency !== 2) {
        context.addIssue({
          code: 'custom',
          path: ['concurrency'],
          message: 'Replay canaries require exactly two atomic attempts',
        });
      }
    }),
]);

export async function POST(request: Request) {
  const gate = await guardPermission('admin:users');
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Invalid Phase 39 request', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const result =
      parsed.data.action === 'create_manifest'
        ? await createSnapshotExportManifest({
            actorId: gate.profile.id,
            entityId: parsed.data.entity_id,
            idempotencyKey: parsed.data.idempotency_key,
            metadata: parsed.data.metadata,
            validUntil: parsed.data.valid_until,
          })
        : await runSnapshotRetirementCanary({
            actorId: gate.profile.id,
            entityId: parsed.data.entity_id,
            kind: parsed.data.kind,
            idempotencyKey: parsed.data.idempotency_key,
            durationSeconds: parsed.data.duration_seconds,
            concurrency: parsed.data.concurrency,
          });
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    captureException(error, { route: 'snapshot-retirement-phase39' });
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Phase 39 failed' },
      { status: 500 },
    );
  }
}
