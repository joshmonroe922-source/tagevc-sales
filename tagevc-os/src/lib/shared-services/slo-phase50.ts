import { createPersistClient } from '@/lib/supabase/persist-client';

export const PHASE50_SLO_CONTRACT_VERSION = 'phase50-v1';

/**
 * Compare each owner's latest Phase 49 digest delivery success SLO snapshot
 * against the closest snapshot at least 7 days earlier, recording a
 * week-over-week trend. Read + append-only — never mutates production alert
 * evaluation or delivery paths. NOT a full push notification system.
 */
export async function recordSloOwnerDigestWowTrendPhase50(input?: {
  actorId?: string | null;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'record_slo_owner_digest_wow_trend_phase50',
    { p_actor_id: input?.actorId ?? null },
  );
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Self-serve opt-in toggle. An owner may opt themselves in/out of viewing
 * their own digest delivery failures; a firm-wide actor may also change it
 * on the owner's behalf. Always appends — never mutates prior history.
 */
export async function setSloOwnerDigestSelfServeOptInPhase50(input: {
  ownerId: string;
  actorId: string;
  optedIn: boolean;
  reason?: string | null;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'set_slo_owner_digest_self_serve_opt_in_phase50',
    {
      p_owner_id: input.ownerId,
      p_actor_id: input.actorId,
      p_opted_in: input.optedIn,
      p_reason: input.reason ?? null,
    },
  );
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, detail: (data as Record<string, unknown> | null) ?? undefined };
}

/**
 * Self-serve, pull-only view of an owner's own digest delivery failures.
 * Returns rows ONLY when the owner is currently opted in AND the caller is
 * the owner themselves or a firm-wide actor. Never pushes — the caller must
 * explicitly request this view.
 */
export async function listSloOwnerDigestSelfServeFailuresPhase50(input: {
  ownerId: string;
  actorId: string;
  days?: number;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'list_slo_owner_digest_self_serve_failures_phase50',
    {
      p_owner_id: input.ownerId,
      p_actor_id: input.actorId,
      p_days: input.days ?? 30,
    },
  );
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, detail: (data as Record<string, unknown> | null) ?? undefined };
}

export async function getSloPhase50OwnerDigestReport() {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('get_slo_phase50_owner_digest_report');
  if (error) {
    console.error(
      'slo phase50 owner digest report unavailable',
      error.message,
    );
    return null;
  }
  return data;
}

export async function processSloGovernancePhase50(input?: {
  actorId?: string;
}) {
  let ownerDigestWowTrend: unknown = null;
  try {
    ownerDigestWowTrend = await recordSloOwnerDigestWowTrendPhase50({
      actorId: input?.actorId ?? null,
    });
  } catch (error) {
    console.error(
      'slo phase50 owner digest WoW trend scan unavailable',
      error instanceof Error ? error.message : error,
    );
  }

  return {
    ownerDigestWowTrend,
    full_push: false,
  };
}
