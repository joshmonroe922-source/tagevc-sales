import { createHash, randomBytes } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';

export const PHASE39_CONTRACT_VERSION = 'phase39-v1';
export const PHASE39_MAX_METADATA_BYTES = 4096;
export const PHASE39_MAX_DURATION_SECONDS = 300;
export const PHASE39_MAX_CONCURRENCY = 8;

const FORBIDDEN_KEY = /(payload|secret|token|password|authorization|cookie)/i;
const ALLOWED_METADATA_KEYS = new Set([
  'purpose',
  'requested_from',
  'code_revision',
  'ticket_id',
  'note',
  'environment',
]);

export type SnapshotCanaryKind = 'replay' | 'concurrency';

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function validateBoundedMetadata(
  metadata: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  const unsupported = Object.keys(metadata).find(
    (key) => !ALLOWED_METADATA_KEYS.has(key),
  );
  if (unsupported) return { ok: false, error: `Unsupported metadata key: ${unsupported}` };
  const nonString = Object.entries(metadata).find(([, value]) => typeof value !== 'string');
  if (nonString) {
    return { ok: false, error: `Metadata value must be a string: ${nonString[0]}` };
  }
  const visit = (value: unknown, depth: number): string | null => {
    if (depth > 4) return 'Metadata nesting exceeds four levels';
    if (Array.isArray(value)) {
      if (value.length > 50) return 'Metadata arrays are limited to 50 items';
      for (const child of value) {
        const error = visit(child, depth + 1);
        if (error) return error;
      }
    } else if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length > 50) return 'Metadata objects are limited to 50 keys';
      for (const [key, child] of entries) {
        if (FORBIDDEN_KEY.test(key)) return `Forbidden metadata key: ${key}`;
        const error = visit(child, depth + 1);
        if (error) return error;
      }
    } else if (
      typeof value === 'string' &&
      (value.length > 200 ||
        /^(bearer\s+|eyj[a-z0-9_-]*\.|\s*[\[{])/i.test(value) ||
        /(-----BEGIN|postgres(?:ql)?:\/\/|https?:\/\/[^/\s]+:[^@\s]+@)/i.test(
          value,
        ) ||
        /[A-Za-z0-9_+/\-]{80,}={0,2}/.test(value))
    ) {
      return 'Metadata contains an oversized or credential-like value';
    } else if (typeof value !== 'string') {
      return 'Metadata values must be strings';
    }
    return null;
  };
  const error = visit(metadata, 0);
  if (error) return { ok: false, error };
  if (Buffer.byteLength(canonicalJson(metadata), 'utf8') > PHASE39_MAX_METADATA_BYTES) {
    return { ok: false, error: 'Metadata exceeds 4096 bytes' };
  }
  return { ok: true };
}

export function canaryStepOrdinals(
  kind: SnapshotCanaryKind,
  concurrency: number,
): number[] {
  if (
    !Number.isInteger(concurrency) ||
    (kind === 'replay' && concurrency !== 2) ||
    (kind === 'concurrency' &&
      (concurrency < 2 || concurrency > PHASE39_MAX_CONCURRENCY))
  ) {
    return [];
  }
  return Array.from({ length: concurrency }, (_, index) => index + 1);
}

export async function createSnapshotExportManifest(input: {
  actorId: string;
  entityId?: string | null;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
  validUntil: string;
}) {
  const metadataCheck = validateBoundedMetadata(input.metadata);
  if (!metadataCheck.ok) return metadataCheck;
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('create_snapshot_export_manifest_v1', {
    p_actor_id: input.actorId,
    p_entity_id: input.entityId ?? null,
    p_idempotency_key: input.idempotencyKey,
    p_metadata: input.metadata,
    p_valid_until: input.validUntil,
  });
  if (error || !data) {
    return { ok: false as const, error: error?.message ?? 'Manifest RPC returned no data' };
  }
  const manifest = data as {
    ok?: boolean;
    replay_conflict?: boolean;
    reason?: string;
  };
  if (manifest.ok === false || manifest.replay_conflict) {
    return {
      ok: false as const,
      error: `Manifest replay conflict: ${manifest.reason ?? 'input changed'}`,
    };
  }
  return { ok: true as const, manifest: data };
}

export async function runSnapshotRetirementCanary(input: {
  actorId: string;
  entityId?: string | null;
  kind: SnapshotCanaryKind;
  idempotencyKey: string;
  durationSeconds: number;
  concurrency: number;
}) {
  if (
    !Number.isInteger(input.durationSeconds) ||
    input.durationSeconds < 1 ||
    input.durationSeconds > PHASE39_MAX_DURATION_SECONDS
  ) {
    return { ok: false as const, error: 'Canary duration is outside policy' };
  }
  const ordinals = canaryStepOrdinals(input.kind, input.concurrency);
  if (!ordinals.length) {
    return { ok: false as const, error: 'Canary concurrency is outside policy' };
  }
  const leaseToken = randomBytes(32).toString('hex');
  const sb = await createPersistClient();
  const { data: begun, error: beginError } = await sb.rpc('begin_snapshot_canary_run_v1', {
    p_actor_id: input.actorId,
    p_entity_id: input.entityId ?? null,
    p_canary_kind: input.kind,
    p_idempotency_key: input.idempotencyKey,
    p_duration_seconds: input.durationSeconds,
    p_concurrency: input.concurrency,
    p_lease_token: leaseToken,
  });
  if (beginError || !begun) {
    return { ok: false as const, error: beginError?.message ?? 'Canary lease failed' };
  }
  const run = begun as {
    run_id?: string;
    replayed?: boolean;
    replay_conflict?: boolean;
    reason?: string;
    status?: string;
    lease_generation?: number;
  };
  if (run.replay_conflict) {
    return {
      ok: false as const,
      error: `Canary replay conflict: ${run.reason ?? 'input changed'}`,
    };
  }
  if (run.replayed) return { ok: run.status === 'passed', run };
  if (!run.run_id) return { ok: false as const, error: 'Canary lease returned no run id' };

  if (!run.lease_generation) {
    return { ok: false as const, error: 'Canary lease returned no fence' };
  }
  const recordStep = async (ordinal: number): Promise<string | null> => {
    const { error } = await sb.rpc('record_snapshot_canary_step_v1', {
      p_run_id: run.run_id,
      p_lease_token: leaseToken,
      p_lease_generation: run.lease_generation,
      p_step_ordinal: ordinal,
    });
    return error?.message ?? null;
  };
  const errors =
    input.kind === 'concurrency'
      ? await Promise.all(ordinals.map(recordStep))
      : await (async () => {
          const sequential: Array<string | null> = [];
          for (const ordinal of ordinals) sequential.push(await recordStep(ordinal));
          return sequential;
        })();
  const stepError = errors.find((error): error is string => Boolean(error));
  if (stepError) {
      await sb.rpc('finish_snapshot_canary_run_v1', {
        p_run_id: run.run_id,
        p_lease_token: leaseToken,
        p_lease_generation: run.lease_generation,
        p_abort_reason: stepError,
      });
      return { ok: false as const, error: stepError };
  }
  const { data: finished, error: finishError } = await sb.rpc(
    'finish_snapshot_canary_run_v1',
    {
      p_run_id: run.run_id,
      p_lease_token: leaseToken,
      p_lease_generation: run.lease_generation,
      p_abort_reason: null,
    },
  );
  if (finishError || !finished) {
    return { ok: false as const, error: finishError?.message ?? 'Canary finish failed' };
  }
  const result = finished as { status?: string };
  return { ok: result.status === 'passed', run: result };
}
