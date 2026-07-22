import { createHash } from 'node:crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  canonicalPackageJson,
  recordExternalRetentionCheck,
} from '@/lib/data/snapshot-retirement-phase40';
import {
  getSnapshotEd25519VerifyKeyId,
  loadEd25519PublicKey,
  publicKeySpkiSha256,
  verifyExternalReceiptSignature,
} from '@/lib/data/snapshot-retirement-phase41';

export const PHASE42_SNAPSHOT_CONTRACT_VERSION = 'phase42-v1';
export const PHASE42_DEFAULT_COLD_CADENCE_HOURS = 168;

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function snapshotColdRetentionCadenceHours(): number {
  const raw = process.env.SNAPSHOT_COLD_RETENTION_CHECK_CADENCE_HOURS?.trim();
  if (!raw) return PHASE42_DEFAULT_COLD_CADENCE_HOURS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 24 || parsed > 720) {
    throw new Error(
      'SNAPSHOT_COLD_RETENTION_CHECK_CADENCE_HOURS must be an integer between 24 and 720',
    );
  }
  return parsed;
}

export function buildOfflineVerifyBundle(input: {
  receipt: {
    receipt_id?: string;
    package_id?: string;
    canonical_receipt?: unknown;
    canonical_receipt_text: string;
    receipt_sha256: string;
    verify_key_id: string;
    receipt_signature: string;
    retention_tier?: string;
  };
}) {
  const keyId = input.receipt.verify_key_id || getSnapshotEd25519VerifyKeyId();
  const publicKey = loadEd25519PublicKey(keyId);
  const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const publicKeySpkiB64 = spki.toString('base64');
  const fingerprint = publicKeySpkiSha256(keyId);
  const verified = verifyExternalReceiptSignature({
    canonicalReceiptText: input.receipt.canonical_receipt_text,
    keyId,
    signature: input.receipt.receipt_signature,
  });
  const digestOk =
    sha256Text(input.receipt.canonical_receipt_text) === input.receipt.receipt_sha256;
  return {
    contract_version: PHASE42_SNAPSHOT_CONTRACT_VERSION,
    algorithm: 'ed25519',
    key_id: keyId,
    public_key_spki_b64: publicKeySpkiB64,
    public_key_spki_sha256: fingerprint,
    receipt: {
      receipt_id: input.receipt.receipt_id ?? null,
      package_id: input.receipt.package_id ?? null,
      retention_tier: input.receipt.retention_tier ?? null,
      canonical_receipt: input.receipt.canonical_receipt ?? null,
      canonical_receipt_text: input.receipt.canonical_receipt_text,
      receipt_sha256: input.receipt.receipt_sha256,
      receipt_signature: input.receipt.receipt_signature,
    },
    verification: {
      digest_ok: digestOk,
      signature_ok: verified,
      offline: true,
      private_key_included: false,
    },
    governance: {
      qualification_eligible: false,
      attestation_eligible: false,
      production_relation_mutated: false,
    },
  };
}

export async function publishSnapshotVerifyMaterial(input: { actorId: string }) {
  const keyId = getSnapshotEd25519VerifyKeyId();
  const publicKey = loadEd25519PublicKey(keyId);
  const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const publicKeySpkiB64 = spki.toString('base64');
  const fingerprint = publicKeySpkiSha256(keyId);
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('publish_snapshot_verify_material_phase42', {
    p_actor_id: input.actorId,
    p_key_id: keyId,
    p_public_key_spki_sha256: fingerprint,
    p_public_key_spki_b64: publicKeySpkiB64,
    p_detail: {
      contract_version: PHASE42_SNAPSHOT_CONTRACT_VERSION,
      source: 'SNAPSHOT_EXPORT_ED25519_PUBLIC_KEYS',
    },
  });
  if (error || !data) {
    return { ok: false as const, error: error?.message ?? 'Verify material publish failed' };
  }
  return { ok: true as const, material: data as Record<string, unknown> };
}

export async function exportSnapshotVerifyBundle(input: { receiptId: string }) {
  const sb = await createPersistClient();
  const { data: receipt, error } = await sb
    .from('os_snapshot_external_receipts')
    .select(
      'receipt_id,package_id,retention_tier,canonical_receipt,canonical_receipt_text,receipt_sha256,verify_key_id,receipt_signature',
    )
    .eq('receipt_id', input.receiptId)
    .maybeSingle();
  if (error || !receipt) {
    return { ok: false as const, error: error?.message ?? 'External receipt not found' };
  }
  const bundle = buildOfflineVerifyBundle({
    receipt: {
      receipt_id: String(receipt.receipt_id),
      package_id: String(receipt.package_id),
      retention_tier: String(receipt.retention_tier),
      canonical_receipt: receipt.canonical_receipt,
      canonical_receipt_text: String(receipt.canonical_receipt_text),
      receipt_sha256: String(receipt.receipt_sha256),
      verify_key_id: String(receipt.verify_key_id),
      receipt_signature: String(receipt.receipt_signature),
    },
  });
  return { ok: true as const, bundle };
}

export async function runColdRetentionHeadCadence(input: {
  actorId: string;
  packageId?: string;
  idempotencyKey: string;
}) {
  const cadenceHours = snapshotColdRetentionCadenceHours();
  const sb = await createPersistClient();
  let packageId = input.packageId;
  if (!packageId) {
    const { data: coldPackages, error } = await sb
      .from('os_snapshot_export_packages')
      .select('package_id,retention_tier,retained_until')
      .eq('retention_tier', 'cold')
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) return { ok: false as const, error: error.message };
    packageId = coldPackages?.[0]?.package_id as string | undefined;
    if (!packageId) {
      return { ok: false as const, error: 'No cold-tier export package found' };
    }
  } else {
    const { data: packageRow, error } = await sb
      .from('os_snapshot_export_packages')
      .select('package_id,retention_tier')
      .eq('package_id', packageId)
      .maybeSingle();
    if (error || !packageRow) {
      return { ok: false as const, error: error?.message ?? 'Export package not found' };
    }
    if (packageRow.retention_tier !== 'cold') {
      return { ok: false as const, error: 'Package is not cold-tier' };
    }
  }

  const { data: lastRun } = await sb
    .from('os_snapshot_cold_retention_check_runs')
    .select('checked_at,status')
    .eq('package_id', packageId)
    .neq('status', 'skipped_not_due')
    .order('checked_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastRun?.checked_at) {
    const dueAt =
      Date.parse(String(lastRun.checked_at)) + cadenceHours * 3_600_000;
    if (Date.now() < dueAt) {
      const checkedAt = new Date().toISOString();
      const evidence = {
        cadence_hours: cadenceHours,
        checked_at: checkedAt,
        package_id: packageId,
        reason: 'cadence_not_due',
        status: 'skipped_not_due',
      };
      const evidenceSha256 = sha256Text(canonicalPackageJson(evidence));
      const { data, error } = await sb.rpc(
        'record_snapshot_cold_retention_check_phase42',
        {
          p_actor_id: input.actorId,
          p_package_id: packageId,
          p_idempotency_key: input.idempotencyKey,
          p_retention_check_id: null,
          p_cadence_hours: cadenceHours,
          p_status: 'skipped_not_due',
          p_checked_at: checkedAt,
          p_evidence_sha256: evidenceSha256,
          p_detail: {
            adapter: 'https_head_v1',
            cadence_hours: cadenceHours,
            next_due_at: new Date(dueAt).toISOString(),
          },
        },
      );
      if (error || !data) {
        return {
          ok: false as const,
          error: error?.message ?? 'Cold cadence skip RPC failed',
        };
      }
      return {
        ok: true as const,
        skipped: true as const,
        run: data as Record<string, unknown>,
      };
    }
  }

  const check = await recordExternalRetentionCheck(packageId);
  if (!check.ok) return check;
  const checkId = String(
    (check.check as { check_id?: string } | null)?.check_id ?? '',
  );
  if (!checkId) {
    return { ok: false as const, error: 'Retention check did not return check_id' };
  }
  const checkedAt = check.observation.checkedAt;
  const evidence = {
    cadence_hours: cadenceHours,
    checked_at: checkedAt,
    package_id: packageId,
    retention_check_id: checkId,
    status: check.observation.status,
  };
  const evidenceSha256 = sha256Text(canonicalPackageJson(evidence));
  const { data, error } = await sb.rpc('record_snapshot_cold_retention_check_phase42', {
    p_actor_id: input.actorId,
    p_package_id: packageId,
    p_idempotency_key: input.idempotencyKey,
    p_retention_check_id: checkId,
    p_cadence_hours: cadenceHours,
    p_status: check.observation.status,
    p_checked_at: checkedAt,
    p_evidence_sha256: evidenceSha256,
    p_detail: {
      adapter: 'https_head_v1',
      error_code: check.observation.errorCode,
      http_status: check.observation.httpStatus,
    },
  });
  if (error || !data) {
    return { ok: false as const, error: error?.message ?? 'Cold cadence RPC failed' };
  }
  return {
    ok: true as const,
    skipped: false as const,
    run: data as Record<string, unknown>,
    check: check.check,
    observation: check.observation,
  };
}

export async function getSnapshotPhase42VerifyColdDashboard() {
  const sb = await createPersistClient();
  const [materials, runs, report] = await Promise.all([
    sb
      .from('os_snapshot_public_verify_material')
      .select(
        'material_id,key_id,public_key_spki_sha256,algorithm,published_at,active,qualification_eligible',
      )
      .eq('active', true)
      .order('published_at', { ascending: false })
      .limit(12),
    sb
      .from('os_snapshot_cold_retention_check_runs')
      .select(
        'run_id,package_id,status,cadence_hours,checked_at,evidence_sha256,qualification_eligible',
      )
      .order('checked_at', { ascending: false })
      .limit(12),
    sb.rpc('get_snapshot_phase42_verify_cold_report'),
  ]);
  if (materials.error) {
    return { ok: false as const, error: materials.error.message };
  }
  return {
    ok: true as const,
    verifyMaterial: materials.data ?? [],
    coldRuns: runs.error ? [] : (runs.data ?? []),
    phase42Slo: report.error ? null : (report.data ?? null),
  };
}
