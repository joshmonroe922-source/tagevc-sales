import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { createPersistClient } from '@/lib/supabase/persist-client';

export const PHASE48_SLO_CONTRACT_VERSION = 'phase48-v1';
export const DEFAULT_OWNER_DIGEST_DESTINATION_KEY = 'owner_digest';

type OwnerDigestWebhook = {
  destination_key: string;
  url: string;
  host_sha256: string;
};

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function allowlistedUrl(
  rawUrl: string | undefined | null,
  allowedHostsEnv: string | undefined | null,
): { url: string; host: string } | null {
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
    return { url: url.toString(), host: hostname };
  } catch {
    return null;
  }
}

/**
 * Parse SLO_OWNER_DIGEST_WEBHOOKS JSON map of destination_key → HTTPS URL.
 * Hosts must also appear in SLO_WEBHOOK_ALLOWED_HOSTS. Never logs URLs.
 */
export function parseOwnerDigestWebhooks(
  raw = process.env.SLO_OWNER_DIGEST_WEBHOOKS,
  allowedHosts = process.env.SLO_WEBHOOK_ALLOWED_HOSTS,
): OwnerDigestWebhook[] {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    return [];
  }
  const out: OwnerDigestWebhook[] = [];
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(key)) continue;
    if (typeof value !== 'string') continue;
    const allowed = allowlistedUrl(value, allowedHosts);
    if (!allowed) continue;
    out.push({
      destination_key: key,
      url: allowed.url,
      host_sha256: sha256Hex(allowed.host),
    });
  }
  return out;
}

export async function registerOwnerDigestWebhookAllowlistPhase48(input?: {
  actorId?: string | null;
  webhooks?: OwnerDigestWebhook[];
}) {
  const sb = await createPersistClient();
  const webhooks = input?.webhooks ?? parseOwnerDigestWebhooks();
  const results: Array<Record<string, unknown>> = [];
  for (const webhook of webhooks) {
    const { data, error } = await sb.rpc(
      'register_slo_owner_digest_webhook_allowlist_phase48',
      {
        p_actor_id: input?.actorId ?? null,
        p_destination_key: webhook.destination_key,
        p_host_sha256: webhook.host_sha256,
        p_detail: {
          contract_version: PHASE48_SLO_CONTRACT_VERSION,
          host_registered: true,
        },
      },
    );
    if (error) {
      console.error(
        'slo phase48 digest webhook allowlist register unavailable',
        error.message,
      );
      continue;
    }
    if (data) results.push(data as Record<string, unknown>);
  }
  return {
    registered: results.length,
    results,
    full_push: false,
  };
}

export async function recordSloDigestNotificationDeliveryPhase48(input: {
  actorId?: string | null;
  notificationId?: string | null;
  destinationKey: string;
  deliveryStatus:
    | 'delivered'
    | 'failed'
    | 'skipped_no_webhook'
    | 'skipped_not_allowlisted'
    | 'replayed';
  responseCode?: number | null;
  detail?: Record<string, unknown>;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'record_slo_digest_notification_delivery_phase48',
    {
      p_actor_id: input.actorId ?? null,
      p_notification_id: input.notificationId ?? null,
      p_destination_key: input.destinationKey,
      p_delivery_status: input.deliveryStatus,
      p_response_code: input.responseCode ?? null,
      p_detail: {
        contract_version: PHASE48_SLO_CONTRACT_VERSION,
        ...(input.detail ?? {}),
      },
    },
  );
  if (error) throw new Error(error.message);
  return data;
}

async function deliverOwnerDigestWebhook(
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

/**
 * Deliver allowlisted owner digest webhooks for recent Phase 47 notifications.
 * Ledger-only — not a full push notification system.
 */
export async function deliverSloOwnerDigestWebhooksPhase48(input?: {
  actorId?: string | null;
}) {
  const webhooks = parseOwnerDigestWebhooks();
  await registerOwnerDigestWebhookAllowlistPhase48({
    actorId: input?.actorId,
    webhooks,
  });

  const sb = await createPersistClient();
  const { data: notifications, error } = await sb
    .from('os_slo_handoff_digest_notifications')
    .select(
      'notification_id,publication_id,destination_key,owner_id,delivery_status,created_at',
    )
    .eq('delivery_status', 'notified')
    .order('created_at', { ascending: false })
    .limit(40);
  if (error) {
    console.error(
      'slo phase48 digest notifications unavailable',
      error.message,
    );
    return {
      delivered: 0,
      failed: 0,
      skipped: 0,
      full_push: false,
    };
  }

  let delivered = 0;
  let failed = 0;
  let skipped = 0;

  if (!webhooks.length) {
    for (const notification of notifications ?? []) {
      await recordSloDigestNotificationDeliveryPhase48({
        actorId: input?.actorId,
        notificationId: String(notification.notification_id),
        destinationKey:
          String(notification.destination_key) ||
          DEFAULT_OWNER_DIGEST_DESTINATION_KEY,
        deliveryStatus: 'skipped_no_webhook',
      });
      skipped += 1;
    }
    return { delivered, failed, skipped, full_push: false };
  }

  for (const webhook of webhooks) {
    for (const notification of notifications ?? []) {
      const outcome = await deliverOwnerDigestWebhook(webhook.url, {
        kind: 'slo_owner_digest_webhook',
        contract_version: PHASE48_SLO_CONTRACT_VERSION,
        destination_key: webhook.destination_key,
        notification_id: notification.notification_id,
        publication_id: notification.publication_id,
        owner_id: notification.owner_id,
        full_push: false,
      });
      await recordSloDigestNotificationDeliveryPhase48({
        actorId: input?.actorId,
        notificationId: String(notification.notification_id),
        destinationKey: webhook.destination_key,
        deliveryStatus: outcome.delivery_status,
        responseCode: outcome.response_code,
      });
      if (outcome.delivery_status === 'delivered') delivered += 1;
      else failed += 1;
    }
  }

  return { delivered, failed, skipped, full_push: false };
}

export async function scanSloDigestNotificationDeliverySloPhase48(input?: {
  actorId?: string | null;
  days?: number;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'scan_slo_digest_notification_delivery_slo_phase48',
    {
      p_actor_id: input?.actorId ?? null,
      p_days: input?.days ?? 30,
    },
  );
  if (error) throw new Error(error.message);
  return data;
}

export async function getSloPhase48GovernanceReport() {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('get_slo_phase48_governance_report');
  if (error) {
    console.error('slo phase48 governance report unavailable', error.message);
    return null;
  }
  return data;
}

export async function processSloGovernancePhase48(input?: { actorId?: string }) {
  let allowlist: unknown = null;
  try {
    allowlist = await registerOwnerDigestWebhookAllowlistPhase48({
      actorId: input?.actorId ?? null,
    });
  } catch (error) {
    console.error(
      'slo phase48 digest webhook allowlist unavailable',
      error instanceof Error ? error.message : error,
    );
  }

  let deliveries: unknown = null;
  try {
    deliveries = await deliverSloOwnerDigestWebhooksPhase48({
      actorId: input?.actorId ?? null,
    });
  } catch (error) {
    console.error(
      'slo phase48 digest webhook delivery unavailable',
      error instanceof Error ? error.message : error,
    );
  }

  let deliverySlo: unknown = null;
  try {
    deliverySlo = await scanSloDigestNotificationDeliverySloPhase48({
      actorId: input?.actorId ?? null,
    });
  } catch (error) {
    console.error(
      'slo phase48 digest delivery SLO scan unavailable',
      error instanceof Error ? error.message : error,
    );
  }

  return {
    allowlist,
    deliveries,
    deliverySlo,
    full_push: false,
  };
}
