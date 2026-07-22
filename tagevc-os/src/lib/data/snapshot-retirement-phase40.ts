import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createPersistClient } from '@/lib/supabase/persist-client';

export const PHASE40_CONTRACT_VERSION = 'phase40-v1';
export const PHASE40_MIN_DURATION_MINUTES = 120;
export const PHASE40_MAX_DURATION_MINUTES = 1440;
export const PHASE40_MIN_STEP_INTERVAL_MINUTES = 15;
export const PHASE40_MAX_STEP_INTERVAL_MINUTES = 120;
export const PHASE40_MAX_WORKER_CLAIMS = 4;

type RetentionStatus =
  | 'verified'
  | 'unavailable'
  | 'missing'
  | 'hash_mismatch'
  | 'expired';

type DestinationConfig = {
  url: string;
  hash_header?: string;
  size_header?: string;
};

type PackageRow = {
  package_id: string;
  entity_id: string | null;
  phase39_manifest_id: string;
  destination_key: string;
  artifact_sha256: string;
  artifact_size_bytes: number;
  retained_until: string;
  canonical_package_text: string;
  package_sha256: string;
  signature_key_id: string;
  package_signature: string;
};

type RetentionObservation = {
  status: RetentionStatus;
  checkedAt: string;
  observedSha256: string | null;
  observedSizeBytes: number | null;
  httpStatus: number | null;
  errorCode: string | null;
  detail: Record<string, unknown>;
};

export function canonicalPackageJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalPackageJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(
        ([key, child]) =>
          `${JSON.stringify(key)}:${canonicalPackageJson(child)}`,
      )
      .join(',')}}`;
  }
  const primitive = JSON.stringify(value);
  if (primitive === undefined) {
    throw new Error('Canonical package contains a non-JSON value');
  }
  return primitive;
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function stablePackageId(input: {
  actorId: string;
  entityId?: string | null;
  idempotencyKey: string;
}): string {
  const bytes = createHash('sha256')
    .update(
      canonicalPackageJson({
        actor_id: input.actorId,
        entity_id: input.entityId ?? null,
        idempotency_key: input.idempotencyKey,
      }),
    )
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}

function signingKey(keyId: string): Buffer {
  let encoded = '';
  const keyringRaw = process.env.SNAPSHOT_EXPORT_HMAC_KEYS?.trim();
  if (keyringRaw) {
    const keyring = JSON.parse(keyringRaw) as unknown;
    if (!keyring || Array.isArray(keyring) || typeof keyring !== 'object') {
      throw new Error('SNAPSHOT_EXPORT_HMAC_KEYS must be a JSON object');
    }
    const candidate = (keyring as Record<string, unknown>)[keyId];
    encoded = typeof candidate === 'string' ? candidate.trim() : '';
  } else if (keyId === process.env.SNAPSHOT_EXPORT_HMAC_KEY_ID?.trim()) {
    encoded = process.env.SNAPSHOT_EXPORT_HMAC_KEY?.trim() ?? '';
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error(`Snapshot export signing key is unavailable: ${keyId}`);
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length < 32) {
    throw new Error('Snapshot export signing keys must decode to at least 32 bytes');
  }
  return key;
}

function signingConfig(): { key: Buffer; keyId: string } {
  const keyId = process.env.SNAPSHOT_EXPORT_HMAC_KEY_ID?.trim() ?? '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(keyId)) {
    throw new Error('SNAPSHOT_EXPORT_HMAC_KEY_ID is not configured');
  }
  return { key: signingKey(keyId), keyId };
}

function signCanonicalPackage(canonicalPackageText: string): {
  algorithm: 'hmac-sha256';
  keyId: string;
  signature: string;
} {
  const { key, keyId } = signingConfig();
  return {
    algorithm: 'hmac-sha256',
    keyId,
    signature: createHmac('sha256', key).update(canonicalPackageText).digest('hex'),
  };
}

export function verifyCanonicalPackageSignature(input: {
  canonicalPackageText: string;
  keyId: string;
  signature: string;
}): boolean {
  try {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(input.keyId) ||
      !/^[0-9a-f]{64}$/.test(input.signature)
    ) {
      return false;
    }
    const expected = createHmac('sha256', signingKey(input.keyId))
      .update(input.canonicalPackageText)
      .digest('hex');
    return timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(input.signature, 'hex'),
    );
  } catch {
    return false;
  }
}

export function parseRetentionDestinations(
  raw = process.env.SNAPSHOT_RETENTION_DESTINATIONS ?? '',
  allowedHostsRaw = process.env.SNAPSHOT_RETENTION_ALLOWED_HOSTS ?? '',
): Record<string, DestinationConfig> {
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('SNAPSHOT_RETENTION_DESTINATIONS must be a JSON object');
  }
  const allowedHosts = new Set(
    allowedHostsRaw
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
  if (!allowedHosts.size) {
    throw new Error('SNAPSHOT_RETENTION_ALLOWED_HOSTS is required');
  }
  const destinations: Record<string, DestinationConfig> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,99}$/.test(key)) {
      throw new Error(`Invalid retention destination key: ${key}`);
    }
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      throw new Error(`Invalid retention destination config: ${key}`);
    }
    const config = value as Record<string, unknown>;
    if (typeof config.url !== 'string') {
      throw new Error(`Retention destination URL is required: ${key}`);
    }
    const url = new URL(config.url);
    if (
      url.protocol !== 'https:' ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      isIP(url.hostname) !== 0 ||
      !allowedHosts.has(url.hostname.toLowerCase())
    ) {
      throw new Error(`Unsafe retention destination URL: ${key}`);
    }
    const hashHeader =
      typeof config.hash_header === 'string'
        ? config.hash_header.trim().toLowerCase()
        : undefined;
    const sizeHeader =
      typeof config.size_header === 'string'
        ? config.size_header.trim().toLowerCase()
        : undefined;
    if (
      (hashHeader && !/^[a-z0-9-]{1,64}$/.test(hashHeader)) ||
      (sizeHeader && !/^[a-z0-9-]{1,64}$/.test(sizeHeader))
    ) {
      throw new Error(`Invalid retention metadata header: ${key}`);
    }
    destinations[key] = {
      url: url.toString(),
      hash_header: hashHeader,
      size_header: sizeHeader,
    };
  }
  return destinations;
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    return isPrivateAddress(normalized.slice('::ffff:'.length));
  }
  if (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('2001:db8:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  ) {
    return true;
  }
  const parts = normalized.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  return (
    parts[0] === 0 ||
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 192 && parts[1] === 0 && parts[2] <= 2) ||
    (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) ||
    (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) ||
    (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    parts[0] >= 224
  );
}

async function assertPublicDestination(url: URL): Promise<void> {
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('Retention destination resolved to a non-public address');
  }
}

function normalizeObservedHash(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^"|"$/g, '');
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  const digest = trimmed.match(/^sha-?256=([A-Za-z0-9+/]+={0,2})$/i);
  if (digest) {
    const decoded = Buffer.from(digest[1], 'base64');
    return decoded.length === 32 ? decoded.toString('hex') : null;
  }
  return null;
}

export async function inspectRetentionDestination(
  packageRow: Pick<
    PackageRow,
    | 'destination_key'
    | 'artifact_sha256'
    | 'artifact_size_bytes'
    | 'retained_until'
  >,
  fetchImpl: typeof fetch = fetch,
): Promise<RetentionObservation> {
  const checkedAt = new Date().toISOString();
  const destinations = parseRetentionDestinations();
  const config = destinations[packageRow.destination_key];
  if (!config) {
    return {
      status: 'unavailable',
      checkedAt,
      observedSha256: null,
      observedSizeBytes: null,
      httpStatus: null,
      errorCode: 'destination_not_allowlisted',
      detail: { adapter: 'https_head_v1' },
    };
  }
  try {
    const url = new URL(config.url);
    await assertPublicDestination(url);
    const response = await fetchImpl(url, {
      method: 'HEAD',
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
      headers: { Accept: 'application/octet-stream' },
    });
    const observedSizeText = response.headers.get(
      config.size_header ?? 'content-length',
    );
    const observedSize =
      observedSizeText && /^\d{1,13}$/.test(observedSizeText)
        ? Number(observedSizeText)
        : null;
    const observedHash = normalizeObservedHash(
      response.headers.get(config.hash_header ?? 'x-amz-meta-sha256') ??
        response.headers.get('x-goog-meta-sha256') ??
        response.headers.get('x-checksum-sha256') ??
        response.headers.get('digest') ??
        response.headers.get('etag'),
    );
    const expired = Date.parse(packageRow.retained_until) <= Date.parse(checkedAt);
    let status: RetentionStatus;
    let errorCode: string | null = null;
    if (expired) status = 'expired';
    else if (response.status === 404 || response.status === 410) status = 'missing';
    else if (response.status >= 500 || response.status === 408 || response.status === 429) {
      status = 'unavailable';
      errorCode = 'destination_temporarily_unavailable';
    } else if (!response.ok || response.status >= 300) {
      status = 'unavailable';
      errorCode = 'unexpected_head_status';
    } else if (!observedHash) {
      status = 'unavailable';
      errorCode = 'artifact_hash_metadata_missing';
    } else if (
      observedHash !== packageRow.artifact_sha256 ||
      observedSize !== packageRow.artifact_size_bytes
    ) {
      status = 'hash_mismatch';
      errorCode =
        observedHash !== packageRow.artifact_sha256
          ? 'artifact_hash_mismatch'
          : 'artifact_size_mismatch';
    } else status = 'verified';
    return {
      status,
      checkedAt,
      observedSha256: observedHash,
      observedSizeBytes: observedSize,
      httpStatus: response.status,
      errorCode,
      detail: {
        adapter: 'https_head_v1',
        cache_control_present: Boolean(response.headers.get('cache-control')),
        content_type: response.headers.get('content-type')?.slice(0, 200) ?? null,
      },
    };
  } catch (error) {
    return {
      status: 'unavailable',
      checkedAt,
      observedSha256: null,
      observedSizeBytes: null,
      httpStatus: null,
      errorCode:
        error instanceof Error && error.name === 'TimeoutError'
          ? 'head_timeout'
          : 'head_request_failed',
      detail: { adapter: 'https_head_v1' },
    };
  }
}

export async function createSnapshotExportPackage(input: {
  actorId: string;
  entityId?: string | null;
  phase39ManifestId: string;
  idempotencyKey: string;
  destinationKey: string;
  artifactSha256: string;
  artifactSizeBytes: number;
  contentType: string;
  retainedUntil: string;
}) {
  const destinations = parseRetentionDestinations();
  if (!destinations[input.destinationKey]) {
    return { ok: false as const, error: 'Destination key is not allowlisted' };
  }
  const sb = await createPersistClient();
  const { data: existing, error: existingError } = await sb
    .from('os_snapshot_export_packages')
    .select(
      'package_id,entity_id,phase39_manifest_id,idempotency_key,canonical_package,canonical_package_text,package_sha256,signature_algorithm,signature_key_id,package_signature,destination_key,artifact_sha256,artifact_size_bytes,retained_until',
    )
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();
  if (existingError) return { ok: false as const, error: existingError.message };
  if (existing) {
    const artifact = (existing.canonical_package as { artifact?: Record<string, unknown> })
      .artifact;
    const exactReplay =
      (existing.entity_id ?? null) === (input.entityId ?? null) &&
      existing.phase39_manifest_id === input.phase39ManifestId &&
      existing.destination_key === input.destinationKey &&
      existing.artifact_sha256 === input.artifactSha256.toLowerCase() &&
      Number(existing.artifact_size_bytes) === input.artifactSizeBytes &&
      Date.parse(String(existing.retained_until)) === Date.parse(input.retainedUntil) &&
      artifact?.content_type === input.contentType &&
      sha256Text(String(existing.canonical_package_text)) ===
        existing.package_sha256 &&
      verifyCanonicalPackageSignature({
        canonicalPackageText: String(existing.canonical_package_text),
        keyId: String(existing.signature_key_id),
        signature: String(existing.package_signature),
      });
    return exactReplay
      ? {
          ok: true as const,
          package: {
            ...existing,
            contract_version: PHASE40_CONTRACT_VERSION,
            replayed: true,
          },
        }
      : { ok: false as const, error: 'Package idempotency conflict' };
  }
  const { data: manifest, error: manifestError } = await sb
    .from('os_snapshot_export_manifests')
    .select(
      'manifest_id,entity_id,manifest_version,lifecycle_status,valid_from,valid_until,manifest_sha256',
    )
    .eq('manifest_id', input.phase39ManifestId)
    .maybeSingle();
  if (manifestError || !manifest) {
    return {
      ok: false as const,
      error: manifestError?.message ?? 'Phase 39 manifest not found',
    };
  }
  if ((manifest.entity_id ?? null) !== (input.entityId ?? null)) {
    return { ok: false as const, error: 'Phase 39 manifest entity scope mismatch' };
  }
  const packageId = stablePackageId(input);
  const now = new Date();
  now.setUTCSeconds(0, 0);
  const validFrom = Date.parse(String(manifest.valid_from));
  const validUntil = Date.parse(String(manifest.valid_until));
  const currentlyValid =
    manifest.lifecycle_status === 'valid' &&
    now.getTime() >= validFrom &&
    now.getTime() < validUntil;
  const canonicalPackage = {
    artifact: {
      content_type: input.contentType,
      destination_key: input.destinationKey,
      retained_until: input.retainedUntil,
      sha256: input.artifactSha256.toLowerCase(),
      size_bytes: input.artifactSizeBytes,
    },
    contract_version: PHASE40_CONTRACT_VERSION,
    governance: {
      attestation_eligible: false,
      created_by: input.actorId,
      entity_id: input.entityId ?? null,
      production_relation_mutated: false,
      qualification_eligible: false,
    },
    idempotency_key: input.idempotencyKey,
    package_id: packageId,
    phase39_manifest: {
      currently_valid: currentlyValid,
      lifecycle_status: currentlyValid ? 'valid' : 'expired',
      manifest_id: String(manifest.manifest_id),
      manifest_sha256: String(manifest.manifest_sha256),
      manifest_version: Number(manifest.manifest_version),
      observed_at: now.toISOString(),
      valid_from: new Date(validFrom).toISOString(),
      valid_until: new Date(validUntil).toISOString(),
    },
  };
  const canonicalPackageText = canonicalPackageJson(canonicalPackage);
  if (
    canonicalPackageText.length > 65_536 ||
    /"(?:[^"]*(?:payload|secret|token|password|authorization|cookie|body)[^"]*)"\s*:/i.test(
      canonicalPackageText,
    )
  ) {
    return { ok: false as const, error: 'Canonical package contains unsafe metadata' };
  }
  const signature = signCanonicalPackage(canonicalPackageText);
  const packageSha256 = sha256Text(canonicalPackageText);
  const { data, error } = await sb.rpc('create_snapshot_export_package_v1', {
    p_package_id: packageId,
    p_actor_id: input.actorId,
    p_entity_id: input.entityId ?? null,
    p_phase39_manifest_id: input.phase39ManifestId,
    p_idempotency_key: input.idempotencyKey,
    p_canonical_package: canonicalPackage,
    p_canonical_package_text: canonicalPackageText,
    p_package_sha256: packageSha256,
    p_signature_algorithm: signature.algorithm,
    p_signature_key_id: signature.keyId,
    p_package_signature: signature.signature,
  });
  if (error || !data) {
    return { ok: false as const, error: error?.message ?? 'Package RPC failed' };
  }
  const result = data as { ok?: boolean; replay_conflict?: boolean };
  return result.ok === false || result.replay_conflict
    ? { ok: false as const, error: 'Package idempotency conflict' }
    : {
        ok: true as const,
        package: {
          ...(data as Record<string, unknown>),
          canonical_package: canonicalPackage,
          canonical_package_text: canonicalPackageText,
          contract_version: PHASE40_CONTRACT_VERSION,
          package_sha256: packageSha256,
          signature_algorithm: signature.algorithm,
          signature_key_id: signature.keyId,
          package_signature: signature.signature,
        },
      };
}

async function loadPackage(packageId: string): Promise<
  | { ok: true; packageRow: PackageRow }
  | { ok: false; error: string }
> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_snapshot_export_packages')
    .select(
      'package_id,entity_id,phase39_manifest_id,destination_key,artifact_sha256,artifact_size_bytes,retained_until,canonical_package_text,package_sha256,signature_key_id,package_signature',
    )
    .eq('package_id', packageId)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, error: error?.message ?? 'Export package not found' };
  }
  return { ok: true, packageRow: data as PackageRow };
}

export async function recordExternalRetentionCheck(
  packageId: string,
  orchestrationId: string | null = null,
) {
  const loaded = await loadPackage(packageId);
  if (!loaded.ok) return loaded;
  const packageRow = loaded.packageRow;
  if (
    sha256Text(packageRow.canonical_package_text) !== packageRow.package_sha256 ||
    !verifyCanonicalPackageSignature({
      canonicalPackageText: packageRow.canonical_package_text,
      keyId: packageRow.signature_key_id,
      signature: packageRow.package_signature,
    })
  ) {
    return { ok: false as const, error: 'Export package signature verification failed' };
  }
  const observation = await inspectRetentionDestination(packageRow);
  const evidence = {
    checked_at: observation.checkedAt,
    destination_key: packageRow.destination_key,
    error_code: observation.errorCode,
    expected_sha256: packageRow.artifact_sha256,
    expected_size_bytes: packageRow.artifact_size_bytes,
    http_status: observation.httpStatus,
    observed_sha256: observation.observedSha256,
    observed_size_bytes: observation.observedSizeBytes,
    orchestration_id: orchestrationId,
    package_id: packageId,
    retained_until: packageRow.retained_until,
    status: observation.status,
  };
  const evidenceSha256 = sha256Text(canonicalPackageJson(evidence));
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('record_snapshot_retention_check_v1', {
    p_package_id: packageId,
    p_orchestration_id: orchestrationId,
    p_status: observation.status,
    p_checked_at: observation.checkedAt,
    p_observed_sha256: observation.observedSha256,
    p_observed_size_bytes: observation.observedSizeBytes,
    p_http_status: observation.httpStatus,
    p_error_code: observation.errorCode,
    p_evidence_sha256: evidenceSha256,
    p_detail: observation.detail,
  });
  if (error || !data) {
    return { ok: false as const, error: error?.message ?? 'Retention check RPC failed' };
  }
  return { ok: true as const, check: data, observation };
}

export async function scheduleSnapshotPhase40Canary(input: {
  actorId: string;
  entityId?: string | null;
  packageId: string;
  idempotencyKey: string;
  scheduledFor: string;
  durationMinutes: number;
  stepIntervalMinutes: number;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('schedule_snapshot_phase40_canary_v1', {
    p_actor_id: input.actorId,
    p_entity_id: input.entityId ?? null,
    p_package_id: input.packageId,
    p_idempotency_key: input.idempotencyKey,
    p_scheduled_for: input.scheduledFor,
    p_duration_minutes: input.durationMinutes,
    p_step_interval_minutes: input.stepIntervalMinutes,
  });
  if (error || !data) {
    return { ok: false as const, error: error?.message ?? 'Canary schedule RPC failed' };
  }
  const result = data as { ok?: boolean; replay_conflict?: boolean };
  return result.ok === false || result.replay_conflict
    ? { ok: false as const, error: 'Canary schedule idempotency conflict' }
    : { ok: true as const, orchestration: data };
}

export async function abortSnapshotPhase40Canary(input: {
  actorId: string;
  orchestrationId: string;
  reason: string;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('abort_snapshot_phase40_canary_v1', {
    p_actor_id: input.actorId,
    p_orchestration_id: input.orchestrationId,
    p_reason: input.reason,
  });
  return error || !data
    ? { ok: false as const, error: error?.message ?? 'Canary abort RPC failed' }
    : { ok: true as const, orchestration: data };
}

export async function runSnapshotPhase40Worker(limit = PHASE40_MAX_WORKER_CLAIMS) {
  const boundedLimit = Math.max(1, Math.min(PHASE40_MAX_WORKER_CLAIMS, limit));
  const leaseToken = randomBytes(32).toString('hex');
  const sb = await createPersistClient();
  const { data: claimed, error: claimError } = await sb.rpc(
    'claim_snapshot_phase40_canaries_v1',
    { p_lease_token: leaseToken, p_limit: boundedLimit },
  );
  if (claimError) return { ok: false as const, error: claimError.message };
  const runs = (claimed ?? []) as Array<{
    orchestration_id: string;
    package_id: string;
    lease_generation: number;
  }>;
  const results = [];
  for (const run of runs) {
    const { error: heartbeatError } = await sb.rpc(
      'heartbeat_snapshot_phase40_canary_v1',
      {
        p_orchestration_id: run.orchestration_id,
        p_lease_token: leaseToken,
        p_lease_generation: run.lease_generation,
      },
    );
    if (heartbeatError) {
      results.push({
        orchestration_id: run.orchestration_id,
        ok: false,
        error: heartbeatError.message,
      });
      continue;
    }
    const checked = await recordExternalRetentionCheck(
      run.package_id,
      run.orchestration_id,
    );
    if (!checked.ok) {
      results.push({
        orchestration_id: run.orchestration_id,
        ok: false,
        error: checked.error,
      });
      continue;
    }
    const check = checked.check as { check_id?: string };
    if (!check.check_id) {
      results.push({
        orchestration_id: run.orchestration_id,
        ok: false,
        error: 'Retention check returned no check id',
      });
      continue;
    }
    const { data: step, error: stepError } = await sb.rpc(
      'record_snapshot_phase40_step_v1',
      {
        p_orchestration_id: run.orchestration_id,
        p_lease_token: leaseToken,
        p_lease_generation: run.lease_generation,
        p_retention_check_id: check.check_id,
      },
    );
    results.push({
      orchestration_id: run.orchestration_id,
      ok: !stepError,
      step: step ?? null,
      error: stepError?.message,
    });
  }
  return { ok: results.every((result) => result.ok), claimed: runs.length, results };
}

export async function getSnapshotPhase40Dashboard() {
  const sb = await createPersistClient();
  const [manifests, packages, checks, orchestrations, slo] = await Promise.all([
    sb
      .from('os_snapshot_export_manifest_status')
      .select(
        'manifest_id,entity_id,manifest_version,manifest_sha256,lifecycle_status,valid_until',
      )
      .order('created_at', { ascending: false })
      .limit(10),
    sb
      .from('os_snapshot_export_packages')
      .select(
        'package_id,entity_id,phase39_manifest_id,package_sha256,signature_key_id,destination_key,retained_until,created_at',
      )
      .order('created_at', { ascending: false })
      .limit(10),
    sb
      .from('os_snapshot_retention_checks')
      .select(
        'check_id,package_id,orchestration_id,status,checked_at,evidence_sha256,error_code',
      )
      .order('checked_at', { ascending: false })
      .limit(20),
    sb
      .from('os_snapshot_phase40_orchestrations')
      .select(
        'orchestration_id,package_id,entity_id,status,scheduled_for,deadline_at,expires_at,next_step_at,expected_step_count,completed_step_count,heartbeat_at,completed_at,abort_reason,qualification_eligible,attestation_eligible',
      )
      .order('created_at', { ascending: false })
      .limit(10),
    sb.from('os_snapshot_phase40_slo').select('*').maybeSingle(),
  ]);
  const error =
    manifests.error ??
    packages.error ??
    checks.error ??
    orchestrations.error ??
    slo.error;
  if (error) return { ok: false as const, error: error.message };
  return {
    ok: true as const,
    manifests: manifests.data ?? [],
    packages: packages.data ?? [],
    checks: checks.data ?? [],
    orchestrations: orchestrations.data ?? [],
    slo: slo.data ?? null,
  };
}
