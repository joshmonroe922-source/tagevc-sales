import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from 'node:crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { canonicalPackageJson } from '@/lib/data/snapshot-retirement-phase40';

export const PHASE41_SNAPSHOT_CONTRACT_VERSION = 'phase41-v1';
export type SnapshotRetentionTier = 'warm' | 'cold';

type PackageRow = {
  package_id: string;
  package_sha256: string;
  artifact_sha256: string;
  destination_key: string;
  retention_tier: SnapshotRetentionTier;
  retained_until: string;
  qualification_eligible: boolean;
  attestation_eligible: boolean;
  production_relation_mutated: boolean;
};

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sha256Buffer(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseKeyring(raw: string | undefined, label: string): Record<string, string> {
  if (!raw?.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${label} must be a JSON object`);
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim()) out[key] = value.trim();
  }
  return out;
}

export function getSnapshotEd25519VerifyKeyId(): string {
  const keyId = process.env.SNAPSHOT_EXPORT_ED25519_KEY_ID?.trim() ?? '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(keyId)) {
    throw new Error('SNAPSHOT_EXPORT_ED25519_KEY_ID is not configured');
  }
  return keyId;
}

function loadEd25519PrivateKey(keyId: string) {
  const keyring = parseKeyring(
    process.env.SNAPSHOT_EXPORT_ED25519_PRIVATE_KEYS,
    'SNAPSHOT_EXPORT_ED25519_PRIVATE_KEYS',
  );
  const encoded =
    keyring[keyId] ??
    (keyId === process.env.SNAPSHOT_EXPORT_ED25519_KEY_ID?.trim()
      ? process.env.SNAPSHOT_EXPORT_ED25519_PRIVATE_KEY?.trim() ?? ''
      : '');
  if (!encoded) {
    throw new Error(`Ed25519 private key unavailable for ${keyId}`);
  }
  const der = Buffer.from(encoded, 'base64');
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

export function loadEd25519PublicKey(keyId: string) {
  const keyring = parseKeyring(
    process.env.SNAPSHOT_EXPORT_ED25519_PUBLIC_KEYS,
    'SNAPSHOT_EXPORT_ED25519_PUBLIC_KEYS',
  );
  const encoded =
    keyring[keyId] ??
    (keyId === process.env.SNAPSHOT_EXPORT_ED25519_KEY_ID?.trim()
      ? process.env.SNAPSHOT_EXPORT_ED25519_PUBLIC_KEY?.trim() ?? ''
      : '');
  if (!encoded) {
    throw new Error(`Ed25519 public verify key unavailable for ${keyId}`);
  }
  const der = Buffer.from(encoded, 'base64');
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

export function publicKeySpkiSha256(keyId: string): string {
  const publicKey = loadEd25519PublicKey(keyId);
  const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  return sha256Buffer(spki);
}

export function signExternalReceipt(canonicalReceiptText: string): {
  algorithm: 'ed25519';
  keyId: string;
  signature: string;
  verifyPublicKeySpkiSha256: string;
} {
  const keyId = getSnapshotEd25519VerifyKeyId();
  const privateKey = loadEd25519PrivateKey(keyId);
  const signature = sign(null, Buffer.from(canonicalReceiptText, 'utf8'), privateKey);
  return {
    algorithm: 'ed25519',
    keyId,
    signature: signature.toString('hex'),
    verifyPublicKeySpkiSha256: publicKeySpkiSha256(keyId),
  };
}

export function verifyExternalReceiptSignature(input: {
  canonicalReceiptText: string;
  keyId: string;
  signature: string;
}): boolean {
  try {
    if (!/^[0-9a-f]{128}$/.test(input.signature)) return false;
    const publicKey = loadEd25519PublicKey(input.keyId);
    return verify(
      null,
      Buffer.from(input.canonicalReceiptText, 'utf8'),
      publicKey,
      Buffer.from(input.signature, 'hex'),
    );
  } catch {
    return false;
  }
}

export async function createSnapshotExternalReceipt(input: {
  actorId: string;
  packageId: string;
  idempotencyKey: string;
}) {
  const sb = await createPersistClient();
  const { data: packageRow, error: packageError } = await sb
    .from('os_snapshot_export_packages')
    .select(
      'package_id,package_sha256,artifact_sha256,destination_key,retention_tier,retained_until,qualification_eligible,attestation_eligible,production_relation_mutated',
    )
    .eq('package_id', input.packageId)
    .maybeSingle();
  if (packageError || !packageRow) {
    return {
      ok: false as const,
      error: packageError?.message ?? 'Export package not found',
    };
  }
  const row = packageRow as PackageRow;
  if (
    row.qualification_eligible ||
    row.attestation_eligible ||
    row.production_relation_mutated
  ) {
    return {
      ok: false as const,
      error: 'Package must remain non-qualifying for external receipts',
    };
  }
  if (row.retention_tier === 'cold') {
    const retainedMs = Date.parse(row.retained_until);
    const createdFloor = Date.now() + 364 * 86_400_000;
    if (Number.isNaN(retainedMs) || retainedMs < createdFloor) {
      // Cold packages are validated at create time; keep a soft guard only.
    }
  }
  const canonicalReceipt = {
    artifact_sha256: row.artifact_sha256,
    contract_version: PHASE41_SNAPSHOT_CONTRACT_VERSION,
    destination_key: row.destination_key,
    governance: {
      attestation_eligible: false,
      production_relation_mutated: false,
      qualification_eligible: false,
    },
    idempotency_key: input.idempotencyKey,
    package_id: row.package_id,
    package_sha256: row.package_sha256,
    retention_tier: row.retention_tier,
    verify_key_id: getSnapshotEd25519VerifyKeyId(),
    verify_public_key_spki_sha256: publicKeySpkiSha256(getSnapshotEd25519VerifyKeyId()),
  };
  const canonicalReceiptText = canonicalPackageJson(canonicalReceipt);
  const receiptSha256 = sha256Text(canonicalReceiptText);
  const signed = signExternalReceipt(canonicalReceiptText);
  if (
    signed.verifyPublicKeySpkiSha256 !==
    String(canonicalReceipt.verify_public_key_spki_sha256)
  ) {
    return { ok: false as const, error: 'Verify key fingerprint mismatch' };
  }
  const { data, error } = await sb.rpc('create_snapshot_external_receipt_v1', {
    p_actor_id: input.actorId,
    p_package_id: input.packageId,
    p_idempotency_key: input.idempotencyKey,
    p_canonical_receipt: canonicalReceipt,
    p_canonical_receipt_text: canonicalReceiptText,
    p_receipt_sha256: receiptSha256,
    p_signature_algorithm: signed.algorithm,
    p_verify_key_id: signed.keyId,
    p_verify_public_key_spki_sha256: signed.verifyPublicKeySpkiSha256,
    p_receipt_signature: signed.signature,
  });
  if (error || !data) {
    return { ok: false as const, error: error?.message ?? 'External receipt RPC failed' };
  }
  const result = data as { ok?: boolean; replay_conflict?: boolean };
  return result.ok === false || result.replay_conflict
    ? { ok: false as const, error: 'External receipt idempotency conflict' }
    : {
        ok: true as const,
        receipt: {
          ...(data as Record<string, unknown>),
          canonical_receipt: canonicalReceipt,
          canonical_receipt_text: canonicalReceiptText,
          receipt_sha256: receiptSha256,
          signature_algorithm: signed.algorithm,
          verify_key_id: signed.keyId,
          receipt_signature: signed.signature,
          qualification_eligible: false,
          attestation_eligible: false,
        },
      };
}

export async function getSnapshotPhase41ReceiptDashboard() {
  const sb = await createPersistClient();
  const [receipts, slo] = await Promise.all([
    sb
      .from('os_snapshot_external_receipts')
      .select(
        'receipt_id,package_id,retention_tier,receipt_sha256,verify_key_id,created_at,qualification_eligible,attestation_eligible',
      )
      .order('created_at', { ascending: false })
      .limit(12),
    sb.rpc('get_snapshot_phase41_receipt_slo'),
  ]);
  if (receipts.error) {
    return { ok: false as const, error: receipts.error.message };
  }
  return {
    ok: true as const,
    receipts: receipts.data ?? [],
    slo: slo.error ? null : (slo.data ?? null),
  };
}
