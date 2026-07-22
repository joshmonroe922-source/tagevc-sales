import { createHash } from 'node:crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  getSnapshotEd25519VerifyKeyId,
  loadEd25519PublicKey,
  publicKeySpkiSha256,
} from '@/lib/data/snapshot-retirement-phase41';
import {
  getSnapshotPhase44OpsDashboard,
  runSnapshotPhase44CanaryWorker,
} from '@/lib/data/snapshot-retirement-phase44';
import { webhookUrl } from '@/lib/shared-services/slo-delivery';

export const PHASE45_SNAPSHOT_CONTRACT_VERSION = 'phase45-v1';
export const PHASE45_DEFAULT_CONSECUTIVE_FAILURE_THRESHOLD = 3;
const OPS_DESTINATION_KEY = 'ops_alerts';

export {
  getSnapshotEd25519VerifyKeyId,
  publicKeySpkiSha256,
  runSnapshotPhase44CanaryWorker,
};

export function snapshotConsecutiveFailureThreshold(): number {
  const raw = process.env.SNAPSHOT_CONSECUTIVE_FAILURE_THRESHOLD?.trim();
  if (!raw) return PHASE45_DEFAULT_CONSECUTIVE_FAILURE_THRESHOLD;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error(
      'SNAPSHOT_CONSECUTIVE_FAILURE_THRESHOLD must be an integer between 1 and 100',
    );
  }
  return parsed;
}

function publicKeySpkiB64(keyId: string): string {
  const publicKey = loadEd25519PublicKey(keyId);
  const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  return spki.toString('base64');
}

async function deliverOpsWebhook(payload: Record<string, unknown>): Promise<{
  delivery_status: 'delivered' | 'skipped_no_webhook' | 'failed';
  response_code: number | null;
}> {
  const url = webhookUrl(OPS_DESTINATION_KEY);
  if (!url) {
    return { delivery_status: 'skipped_no_webhook', response_code: null };
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      redirect: 'error',
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return { delivery_status: 'failed', response_code: response.status };
    }
    return { delivery_status: 'delivered', response_code: response.status };
  } catch {
    return { delivery_status: 'failed', response_code: null };
  }
}

export async function announceSnapshotEd25519RotationPhase45(input: {
  actorId: string;
  previousKeyId: string;
  nextKeyId: string;
  detail?: Record<string, unknown>;
}) {
  const previousSpkiSha = publicKeySpkiSha256(input.previousKeyId);
  const nextSpkiSha = publicKeySpkiSha256(input.nextKeyId);
  const previousSpkiB64 = publicKeySpkiB64(input.previousKeyId);
  const nextSpkiB64 = publicKeySpkiB64(input.nextKeyId);
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'announce_snapshot_ed25519_rotation_phase45',
    {
      p_actor_id: input.actorId,
      p_previous_key_id: input.previousKeyId,
      p_next_key_id: input.nextKeyId,
      p_previous_public_key_spki_sha256: previousSpkiSha,
      p_previous_public_key_spki_b64: previousSpkiB64,
      p_next_public_key_spki_sha256: nextSpkiSha,
      p_next_public_key_spki_b64: nextSpkiB64,
      p_detail: {
        contract_version: PHASE45_SNAPSHOT_CONTRACT_VERSION,
        ...(input.detail ?? {}),
      },
    },
  );
  if (error || !data) {
    return {
      ok: false as const,
      error: error?.message ?? 'Ed25519 rotation announce failed',
    };
  }
  return { ok: true as const, rotation: data as Record<string, unknown> };
}

export async function activateSnapshotDualKeyPhase45(input: {
  actorId: string;
  rotationId: string;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('activate_snapshot_dual_key_phase45', {
    p_actor_id: input.actorId,
    p_rotation_id: input.rotationId,
  });
  if (error || !data) {
    return {
      ok: false as const,
      error: error?.message ?? 'Dual-key activation failed',
    };
  }
  return { ok: true as const, rotation: data as Record<string, unknown> };
}

export async function completeSnapshotEd25519CutoverPhase45(input: {
  actorId: string;
  rotationId: string;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'complete_snapshot_ed25519_cutover_phase45',
    {
      p_actor_id: input.actorId,
      p_rotation_id: input.rotationId,
    },
  );
  if (error || !data) {
    return {
      ok: false as const,
      error: error?.message ?? 'Ed25519 cutover completion failed',
    };
  }
  return { ok: true as const, rotation: data as Record<string, unknown> };
}

export async function scanSnapshotConsecutiveFailuresPhase45(input?: {
  actorId?: string;
  threshold?: number;
}) {
  const threshold = input?.threshold ?? snapshotConsecutiveFailureThreshold();
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'scan_snapshot_consecutive_failures_phase45',
    {
      p_actor_id: input?.actorId ?? null,
      p_threshold: threshold,
    },
  );
  if (error || !data) {
    return {
      ok: false as const,
      error: error?.message ?? 'Consecutive failure scan failed',
    };
  }
  return { ok: true as const, scan: data as Record<string, unknown> };
}

export async function listSnapshotPhase45OpsAlerts(limit = 50) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('list_snapshot_phase45_ops_alerts', {
    p_limit: limit,
  });
  if (error) {
    return { ok: false as const, error: error.message };
  }
  return {
    ok: true as const,
    alerts: (data ?? []) as Array<Record<string, unknown>>,
  };
}

/**
 * Scan consecutive failures and page ops webhook when threshold alerts fire.
 * Stage 4e: never flips qualification/attestation flags.
 */
export async function pageSnapshotConsecutiveFailuresPhase45(input?: {
  actorId?: string;
  threshold?: number;
}) {
  const scan = await scanSnapshotConsecutiveFailuresPhase45(input);
  if (!scan.ok) return scan;

  const alerts = await listSnapshotPhase45OpsAlerts(12);
  if (!alerts.ok) {
    return {
      ok: true as const,
      scan: scan.scan,
      paged: 0,
      delivered: 0,
      skipped: 0,
      failed: 0,
      qualification_eligible: false,
      attestation_eligible: false,
      production_relation_mutated: false,
    };
  }

  const threshold = input?.threshold ?? snapshotConsecutiveFailureThreshold();
  let paged = 0;
  let delivered = 0;
  let skipped = 0;
  let failed = 0;
  const day = new Date().toISOString().slice(0, 10);

  for (const alert of alerts.alerts) {
    const kind = String(alert.alert_kind ?? '');
    const count = Number(alert.consecutive_count ?? 0);
    if (count < threshold) continue;
    if (
      kind !== 'consecutive_cold_head_failures' &&
      kind !== 'consecutive_integrity_failures'
    ) {
      continue;
    }
    const createdAt = String(alert.created_at ?? '');
    if (createdAt && !createdAt.startsWith(day)) continue;

    const delivery = await deliverOpsWebhook({
      kind: 'snapshot_phase45_ops_alert',
      version: PHASE45_SNAPSHOT_CONTRACT_VERSION,
      alert_kind: kind,
      window_key: alert.window_key,
      consecutive_count: count,
      threshold,
      metrics_sha256: alert.metrics_sha256 ?? null,
      destination_key: OPS_DESTINATION_KEY,
      qualification_eligible: false,
      attestation_eligible: false,
      production_relation_mutated: false,
    });
    paged += 1;
    if (delivery.delivery_status === 'delivered') delivered += 1;
    else if (delivery.delivery_status === 'skipped_no_webhook') skipped += 1;
    else failed += 1;
  }

  return {
    ok: true as const,
    scan: scan.scan,
    paged,
    delivered,
    skipped,
    failed,
    qualification_eligible: false,
    attestation_eligible: false,
    production_relation_mutated: false,
  };
}

export async function runSnapshotPhase45OpsWorker(input?: {
  actorId?: string;
}) {
  const phase44 = await runSnapshotPhase44CanaryWorker({
    actorId: input?.actorId,
  });
  const paging = await pageSnapshotConsecutiveFailuresPhase45({
    actorId: input?.actorId,
  });
  return {
    ok: Boolean(phase44.ok && paging.ok),
    phase44,
    phase45: paging,
    qualification_eligible: false,
    attestation_eligible: false,
    production_relation_mutated: false,
  };
}

export async function getSnapshotPhase45OpsDashboard() {
  const [phase44, rotations, counters, alerts, report] = await Promise.all([
    getSnapshotPhase44OpsDashboard(),
    (async () => {
      const sb = await createPersistClient();
      return sb
        .from('os_snapshot_ed25519_key_rotations')
        .select(
          'rotation_id,previous_key_id,next_key_id,status,cutover_started_at,cutover_completed_at,created_at,qualification_eligible,attestation_eligible,production_relation_mutated',
        )
        .order('created_at', { ascending: false })
        .limit(12);
    })(),
    (async () => {
      const sb = await createPersistClient();
      return sb
        .from('os_snapshot_consecutive_failure_counters')
        .select(
          'counter_kind,consecutive_count,last_failure_at,last_success_at,updated_at,qualification_eligible',
        )
        .order('counter_kind');
    })(),
    listSnapshotPhase45OpsAlerts(12),
    (async () => {
      const sb = await createPersistClient();
      return sb.rpc('get_snapshot_phase45_ops_report');
    })(),
  ]);

  return {
    ...phase44,
    ok: true as const,
    ed25519Rotations: rotations.error ? [] : (rotations.data ?? []),
    consecutiveFailureCounters: counters.error ? [] : (counters.data ?? []),
    phase45OpsAlerts: alerts.ok ? alerts.alerts : [],
    phase45Slo: report.error ? null : (report.data ?? null),
  };
}

/** Helper for tests / dashboards: public metadata fingerprint only. */
export function rotationPublicKeyFingerprint(keyId: string): {
  keyId: string;
  public_key_spki_sha256: string;
  public_key_spki_b64: string;
} {
  const b64 = publicKeySpkiB64(keyId);
  return {
    keyId,
    public_key_spki_sha256: createHash('sha256')
      .update(Buffer.from(b64, 'base64'))
      .digest('hex'),
    public_key_spki_b64: b64,
  };
}
