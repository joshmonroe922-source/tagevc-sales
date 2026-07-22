import { createPersistClient } from '@/lib/supabase/persist-client';

export const PHASE49_SLO_CONTRACT_VERSION = 'phase49-v1';

/**
 * Scan Phase 48 owner-digest delivery evidence into per-owner success SLO
 * snapshots. Read + append-only — never mutates production alert evaluation
 * or delivery paths. NOT a full push notification system.
 */
export async function scanSloOwnerDigestDeliverySuccessPhase49(input?: {
  actorId?: string | null;
  days?: number;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'scan_slo_owner_digest_delivery_success_phase49',
    {
      p_actor_id: input?.actorId ?? null,
      p_days: input?.days ?? 30,
    },
  );
  if (error) throw new Error(error.message);
  return data;
}

export async function getSloPhase49OwnerDigestReport() {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('get_slo_phase49_owner_digest_report');
  if (error) {
    console.error(
      'slo phase49 owner digest report unavailable',
      error.message,
    );
    return null;
  }
  return data;
}

export async function processSloGovernancePhase49(input?: {
  actorId?: string;
}) {
  let ownerDigestSlo: unknown = null;
  try {
    ownerDigestSlo = await scanSloOwnerDigestDeliverySuccessPhase49({
      actorId: input?.actorId ?? null,
    });
  } catch (error) {
    console.error(
      'slo phase49 owner digest delivery success scan unavailable',
      error instanceof Error ? error.message : error,
    );
  }

  return {
    ownerDigestSlo,
    full_push: false,
  };
}
