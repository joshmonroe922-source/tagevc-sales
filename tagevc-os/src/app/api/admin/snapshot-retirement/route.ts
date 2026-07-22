import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createSnapshotExportManifest,
  runSnapshotRetirementCanary,
} from '@/lib/data/snapshot-retirement-phase39';
import {
  abortSnapshotPhase40Canary,
  createSnapshotExportPackage,
  getSnapshotPhase40Dashboard,
  recordExternalRetentionCheck,
  runSnapshotPhase40Worker,
  scheduleSnapshotPhase40Canary,
} from '@/lib/data/snapshot-retirement-phase40';
import { createSnapshotExternalReceipt } from '@/lib/data/snapshot-retirement-phase41';
import {
  exportSnapshotVerifyBundle,
  publishSnapshotVerifyMaterial,
  runColdRetentionHeadCadence,
} from '@/lib/data/snapshot-retirement-phase42';
import {
  publishFirmWideVerifyMaterialPhase43,
  runProductionColdHeadCadencePhase43,
} from '@/lib/data/snapshot-retirement-phase43';
import {
  getSnapshotPhase44OpsDashboard,
  scheduleSnapshotPhase44CanaryOps,
  verifySnapshotExportPackageIntegrityPhase44,
} from '@/lib/data/snapshot-retirement-phase44';
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
  z.object({
    action: z.literal('create_package'),
    entity_id: z.string().trim().min(1).max(100).nullable().optional(),
    phase39_manifest_id: z.uuid(),
    idempotency_key: idempotencyKeySchema,
    destination_key: z
      .string()
      .trim()
      .min(3)
      .max(100)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,99}$/),
    artifact_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    artifact_size_bytes: z.number().int().min(1).max(1_099_511_627_776),
    content_type: z.string().trim().min(3).max(200),
    retained_until: z.iso.datetime(),
    retention_tier: z.enum(['warm', 'cold']).default('warm'),
  }),
  z.object({
    action: z.literal('check_retention'),
    package_id: z.uuid(),
  }),
  z.object({
    action: z.literal('create_external_receipt'),
    package_id: z.uuid(),
    idempotency_key: idempotencyKeySchema,
  }),
  z.object({
    action: z.literal('publish_verify_material'),
  }),
  z.object({
    action: z.literal('export_verify_bundle'),
    receipt_id: z.uuid(),
  }),
  z.object({
    action: z.literal('check_cold_retention'),
    package_id: z.uuid().optional(),
    idempotency_key: idempotencyKeySchema,
  }),
  z.object({
    action: z.literal('publish_firm_wide_verify'),
  }),
  z.object({
    action: z.literal('check_production_cold_retention'),
    idempotency_key: idempotencyKeySchema,
    limit: z.number().int().min(1).max(100).default(25),
  }),
  z.object({
    action: z.literal('verify_package_integrity'),
    package_id: z.uuid(),
  }),
  z
    .object({
      action: z.literal('schedule_phase44_canary'),
      package_id: z.uuid().optional(),
      definition_id: z
        .string()
        .trim()
        .min(3)
        .max(64)
        .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/)
        .optional(),
      cadence_hours: z.number().int().min(1).max(168).default(6),
    })
    .superRefine((value, context) => {
      if (!value.package_id && !value.definition_id) {
        context.addIssue({
          code: 'custom',
          path: ['package_id'],
          message: 'Phase 44 canary schedules require package_id or definition_id',
        });
      }
    }),
  z.object({
    action: z.literal('schedule_phase40_canary'),
    entity_id: z.string().trim().min(1).max(100).nullable().optional(),
    package_id: z.uuid(),
    idempotency_key: idempotencyKeySchema,
    scheduled_for: z.iso.datetime(),
    duration_minutes: z.number().int().min(120).max(1440),
    step_interval_minutes: z.number().int().min(15).max(120),
  }),
  z.object({
    action: z.literal('abort_phase40_canary'),
    orchestration_id: z.uuid(),
    reason: z.string().trim().min(8).max(500),
  }),
  z.object({
    action: z.literal('tick_phase40_orchestrations'),
    limit: z.number().int().min(1).max(4).default(4),
  }),
]);

export async function GET() {
  const gate = await guardPermission('admin:users');
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
  }
  try {
    const [phase40, phase44] = await Promise.all([
      getSnapshotPhase40Dashboard(),
      getSnapshotPhase44OpsDashboard(),
    ]);
    if (!phase40.ok) {
      return NextResponse.json(phase40, { status: 503 });
    }
    return NextResponse.json({
      ...phase40,
      verifyMaterial: phase44.verifyMaterial,
      coldRuns: phase44.coldRuns,
      phase42Slo: phase44.phase42Slo,
      firmWideVerifyMaterial: phase44.firmWideVerifyMaterial,
      productionColdSchedules: phase44.productionColdSchedules,
      phase43Slo: phase44.phase43Slo,
      integrityChecks: phase44.integrityChecks,
      retentionAlerts: phase44.retentionAlerts,
      phase44CanarySchedules: phase44.phase44CanarySchedules,
      phase44Slo: phase44.phase44Slo,
    });
  } catch (error) {
    captureException(error, { route: 'snapshot-retirement-phase40-dashboard' });
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Phase 40 failed' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Invalid snapshot retirement request',
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }
  if (parsed.data.action === 'tick_phase40_orchestrations') {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    try {
      const result = await runSnapshotPhase40Worker(parsed.data.limit);
      return NextResponse.json(result, { status: result.ok ? 200 : 503 });
    } catch (error) {
      captureException(error, { route: 'snapshot-retirement-phase40-worker' });
      return NextResponse.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : 'Phase 40 worker failed',
        },
        { status: 500 },
      );
    }
  }
  const gate = await guardPermission('admin:users');
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
  }
  try {
    let result;
    switch (parsed.data.action) {
      case 'create_manifest':
        result = await createSnapshotExportManifest({
          actorId: gate.profile.id,
          entityId: parsed.data.entity_id,
          idempotencyKey: parsed.data.idempotency_key,
          metadata: parsed.data.metadata,
          validUntil: parsed.data.valid_until,
        });
        break;
      case 'run_canary':
        result = await runSnapshotRetirementCanary({
          actorId: gate.profile.id,
          entityId: parsed.data.entity_id,
          kind: parsed.data.kind,
          idempotencyKey: parsed.data.idempotency_key,
          durationSeconds: parsed.data.duration_seconds,
          concurrency: parsed.data.concurrency,
        });
        break;
      case 'create_package':
        result = await createSnapshotExportPackage({
          actorId: gate.profile.id,
          entityId: parsed.data.entity_id,
          phase39ManifestId: parsed.data.phase39_manifest_id,
          idempotencyKey: parsed.data.idempotency_key,
          destinationKey: parsed.data.destination_key,
          artifactSha256: parsed.data.artifact_sha256,
          artifactSizeBytes: parsed.data.artifact_size_bytes,
          contentType: parsed.data.content_type,
          retainedUntil: parsed.data.retained_until,
          retentionTier: parsed.data.retention_tier,
        });
        break;
      case 'check_retention':
        result = await recordExternalRetentionCheck(parsed.data.package_id);
        break;
      case 'create_external_receipt':
        result = await createSnapshotExternalReceipt({
          actorId: gate.profile.id,
          packageId: parsed.data.package_id,
          idempotencyKey: parsed.data.idempotency_key,
        });
        break;
      case 'publish_verify_material':
        result = await publishSnapshotVerifyMaterial({
          actorId: gate.profile.id,
        });
        break;
      case 'publish_firm_wide_verify':
        result = await publishFirmWideVerifyMaterialPhase43({
          actorId: gate.profile.id,
        });
        break;
      case 'export_verify_bundle':
        result = await exportSnapshotVerifyBundle({
          receiptId: parsed.data.receipt_id,
        });
        break;
      case 'check_cold_retention':
        result = await runColdRetentionHeadCadence({
          actorId: gate.profile.id,
          packageId: parsed.data.package_id,
          idempotencyKey: parsed.data.idempotency_key,
        });
        break;
      case 'check_production_cold_retention':
        result = await runProductionColdHeadCadencePhase43({
          actorId: gate.profile.id,
          idempotencyKey: parsed.data.idempotency_key,
          limit: parsed.data.limit,
        });
        break;
      case 'verify_package_integrity':
        result = await verifySnapshotExportPackageIntegrityPhase44({
          actorId: gate.profile.id,
          packageId: parsed.data.package_id,
        });
        break;
      case 'schedule_phase44_canary':
        result = await scheduleSnapshotPhase44CanaryOps({
          actorId: gate.profile.id,
          packageId: parsed.data.package_id,
          definitionId: parsed.data.definition_id,
          cadenceHours: parsed.data.cadence_hours,
        });
        break;
      case 'schedule_phase40_canary':
        result = await scheduleSnapshotPhase40Canary({
          actorId: gate.profile.id,
          entityId: parsed.data.entity_id,
          packageId: parsed.data.package_id,
          idempotencyKey: parsed.data.idempotency_key,
          scheduledFor: parsed.data.scheduled_for,
          durationMinutes: parsed.data.duration_minutes,
          stepIntervalMinutes: parsed.data.step_interval_minutes,
        });
        break;
      case 'abort_phase40_canary':
        result = await abortSnapshotPhase40Canary({
          actorId: gate.profile.id,
          orchestrationId: parsed.data.orchestration_id,
          reason: parsed.data.reason,
        });
        break;
    }
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    captureException(error, { route: 'snapshot-retirement-phase39-phase40' });
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Snapshot retirement failed',
      },
      { status: 500 },
    );
  }
}
