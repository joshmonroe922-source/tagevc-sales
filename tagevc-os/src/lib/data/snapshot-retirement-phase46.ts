import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  getSnapshotPhase45OpsDashboard,
  pageSnapshotConsecutiveFailuresPhase45,
  runSnapshotPhase45OpsWorker,
} from '@/lib/data/snapshot-retirement-phase45';
import { webhookUrl } from '@/lib/shared-services/slo-delivery';

export const PHASE46_SNAPSHOT_CONTRACT_VERSION = 'phase46-v1';
export const PHASE46_ONCALL_DESTINATION_KEY = 'oncall';
export const PHASE46_OPS_DESTINATION_KEY = 'ops_alerts';

export type SnapshotCutoverVerifierKind =
  | 'offline_script'
  | 'admin'
  | 'worker';

function allowlistedWebhookUrl(
  rawUrl: string | undefined | null,
  allowedHostsEnv: string | undefined | null,
): string | null {
  const value = rawUrl?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const allowedHosts = new Set(
      (allowedHostsEnv ?? '')
        .split(',')
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    );
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443') ||
      !hostname.includes('.') ||
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      isIP(hostname) !== 0 ||
      !allowedHosts.has(hostname)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/** Prefer SNAPSHOT_ONCALL_WEBHOOK, else SLO_WEBHOOK_OPS_ALERTS via destination key. */
export function snapshotOncallWebhookUrl(): {
  url: string | null;
  destination_key: typeof PHASE46_ONCALL_DESTINATION_KEY | typeof PHASE46_OPS_DESTINATION_KEY;
} {
  const oncall = allowlistedWebhookUrl(
    process.env.SNAPSHOT_ONCALL_WEBHOOK,
    process.env.SLO_WEBHOOK_ALLOWED_HOSTS,
  );
  if (oncall) {
    return { url: oncall, destination_key: PHASE46_ONCALL_DESTINATION_KEY };
  }
  const ops = webhookUrl(PHASE46_OPS_DESTINATION_KEY);
  return {
    url: ops,
    destination_key: PHASE46_OPS_DESTINATION_KEY,
  };
}

async function deliverOncallWebhook(
  url: string,
  payload: Record<string, unknown>,
): Promise<{
  delivery_status: 'delivered' | 'failed';
  response_code: number | null;
}> {
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

export function cutoverAcceptanceSha256(input: {
  rotationId: string;
  verifierKind: SnapshotCutoverVerifierKind;
  previousKeyId: string;
  nextKeyId: string;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        contract_version: PHASE46_SNAPSHOT_CONTRACT_VERSION,
        next_key_id: input.nextKeyId,
        previous_key_id: input.previousKeyId,
        rotation_id: input.rotationId,
        verifier_kind: input.verifierKind,
      }),
      'utf8',
    )
    .digest('hex');
}

export async function recordSnapshotCutoverAcceptancePhase46(input: {
  actorId: string;
  rotationId: string;
  verifierKind: SnapshotCutoverVerifierKind;
  previousKeyId: string;
  nextKeyId: string;
  detail?: Record<string, unknown>;
}) {
  const acceptanceSha = cutoverAcceptanceSha256({
    rotationId: input.rotationId,
    verifierKind: input.verifierKind,
    previousKeyId: input.previousKeyId,
    nextKeyId: input.nextKeyId,
  });
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'record_snapshot_cutover_acceptance_phase46',
    {
      p_actor_id: input.actorId,
      p_rotation_id: input.rotationId,
      p_verifier_kind: input.verifierKind,
      p_acceptance_sha256: acceptanceSha,
      p_detail: {
        contract_version: PHASE46_SNAPSHOT_CONTRACT_VERSION,
        ...(input.detail ?? {}),
      },
    },
  );
  if (error || !data) {
    return {
      ok: false as const,
      error: error?.message ?? 'Cutover acceptance recording failed',
    };
  }
  return { ok: true as const, acceptance: data as Record<string, unknown> };
}

export async function completeSnapshotEd25519CutoverPhase46(input: {
  actorId: string;
  rotationId: string;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'complete_snapshot_ed25519_cutover_phase46',
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

export async function routeSnapshotOncallPagePhase46(input: {
  actorId?: string;
  destinationKey?: string;
  windowKey: string;
  deliveryStatus: 'delivered' | 'failed' | 'skipped_no_webhook' | 'skipped_paused';
  responseCode?: number | null;
  detail?: Record<string, unknown>;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('route_snapshot_oncall_page_phase46', {
    p_actor_id: input.actorId ?? null,
    p_destination_key: input.destinationKey ?? PHASE46_ONCALL_DESTINATION_KEY,
    p_window_key: input.windowKey,
    p_delivery_status: input.deliveryStatus,
    p_response_code: input.responseCode ?? null,
    p_detail: {
      contract_version: PHASE46_SNAPSHOT_CONTRACT_VERSION,
      ...(input.detail ?? {}),
    },
  });
  if (error || !data) {
    return {
      ok: false as const,
      error: error?.message ?? 'On-call page routing failed',
    };
  }
  return { ok: true as const, route: data as Record<string, unknown> };
}

/**
 * Route on-call webhook delivery evidence from an existing Phase 45 paging
 * result (SNAPSHOT_ONCALL_WEBHOOK or SLO_WEBHOOK_OPS_ALERTS + allowlist).
 */
export async function routeOncallAfterConsecutivePagingPhase46(input: {
  actorId?: string;
  paging: Awaited<ReturnType<typeof pageSnapshotConsecutiveFailuresPhase45>>;
}) {
  const paging = input.paging;
  if (!paging.ok) return paging;

  const webhook = snapshotOncallWebhookUrl();
  const day = new Date().toISOString().slice(0, 10);
  let routed = 0;
  let delivered = 0;
  let skipped = 0;
  let failed = 0;

  const shouldPage = (paging.paged ?? 0) > 0;
  if (!shouldPage) {
    return {
      ok: true as const,
      phase45: paging,
      routed: 0,
      delivered: 0,
      skipped: 0,
      failed: 0,
      qualification_eligible: false,
      attestation_eligible: false,
      production_relation_mutated: false,
    };
  }

  const windowKey = `phase46:oncall:${webhook.destination_key}:${day}:consec`;
  let deliveryStatus:
    | 'delivered'
    | 'failed'
    | 'skipped_no_webhook'
    | 'skipped_paused' = 'skipped_no_webhook';
  let responseCode: number | null = null;

  if (!webhook.url) {
    deliveryStatus = 'skipped_no_webhook';
    skipped += 1;
  } else {
    const delivery = await deliverOncallWebhook(webhook.url, {
      kind: 'snapshot_phase46_oncall_page',
      version: PHASE46_SNAPSHOT_CONTRACT_VERSION,
      destination_key: webhook.destination_key,
      window_key: windowKey,
      phase45_paged: paging.paged,
      phase45_delivered: paging.delivered,
      qualification_eligible: false,
      attestation_eligible: false,
      production_relation_mutated: false,
    });
    deliveryStatus = delivery.delivery_status;
    responseCode = delivery.response_code;
    if (delivery.delivery_status === 'delivered') delivered += 1;
    else failed += 1;
  }

  const routedResult = await routeSnapshotOncallPagePhase46({
    actorId: input.actorId,
    destinationKey: webhook.destination_key,
    windowKey,
    deliveryStatus,
    responseCode,
    detail: {
      phase45_paged: paging.paged ?? 0,
      phase45_delivered: paging.delivered ?? 0,
    },
  });
  if (routedResult.ok) routed += 1;

  return {
    ok: routedResult.ok,
    phase45: paging,
    route: routedResult.ok ? routedResult.route : null,
    error: routedResult.ok ? undefined : routedResult.error,
    routed,
    delivered,
    skipped,
    failed,
    qualification_eligible: false,
    attestation_eligible: false,
    production_relation_mutated: false,
  };
}

/**
 * Scan consecutive failures then route on-call delivery evidence.
 */
export async function pageSnapshotOncallRoutesPhase46(input?: {
  actorId?: string;
}) {
  const paging = await pageSnapshotConsecutiveFailuresPhase45({
    actorId: input?.actorId,
  });
  return routeOncallAfterConsecutivePagingPhase46({
    actorId: input?.actorId,
    paging,
  });
}

export async function runSnapshotPhase46OpsWorker(input?: {
  actorId?: string;
}) {
  const phase45 = await runSnapshotPhase45OpsWorker({
    actorId: input?.actorId,
  });
  const oncall = await routeOncallAfterConsecutivePagingPhase46({
    actorId: input?.actorId,
    paging: phase45.phase45,
  });
  return {
    ok: Boolean(phase45.ok && oncall.ok),
    phase45,
    phase46: oncall,
    qualification_eligible: false,
    attestation_eligible: false,
    production_relation_mutated: false,
  };
}

export async function getSnapshotPhase46OpsDashboard() {
  const [phase45, acceptances, routes, deliveries, report] = await Promise.all([
    getSnapshotPhase45OpsDashboard(),
    (async () => {
      const sb = await createPersistClient();
      return sb
        .from('os_snapshot_ed25519_cutover_acceptances')
        .select(
          'acceptance_id,rotation_id,verifier_kind,acceptance_sha256,previous_key_id,next_key_id,dual_acceptance_complete,created_at,qualification_eligible,attestation_eligible,production_relation_mutated',
        )
        .order('created_at', { ascending: false })
        .limit(24);
    })(),
    (async () => {
      const sb = await createPersistClient();
      return sb
        .from('os_snapshot_oncall_page_routes')
        .select(
          'route_id,destination_key,route_status,last_paged_at,updated_at,qualification_eligible',
        )
        .order('destination_key');
    })(),
    (async () => {
      const sb = await createPersistClient();
      return sb
        .from('os_snapshot_oncall_page_deliveries')
        .select(
          'delivery_id,route_id,window_key,delivery_status,response_code,evidence_sha256,created_at,qualification_eligible',
        )
        .order('created_at', { ascending: false })
        .limit(12);
    })(),
    (async () => {
      const sb = await createPersistClient();
      return sb.rpc('get_snapshot_phase46_ops_report');
    })(),
  ]);

  return {
    ...phase45,
    ok: true as const,
    cutoverAcceptances: acceptances.error ? [] : (acceptances.data ?? []),
    oncallRoutes: routes.error ? [] : (routes.data ?? []),
    oncallDeliveries: deliveries.error ? [] : (deliveries.data ?? []),
    phase46Slo: report.error ? null : (report.data ?? null),
  };
}
