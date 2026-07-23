import { createPersistClient } from '@/lib/supabase/persist-client';

export const PHASE51_SLO_CONTRACT_VERSION = 'phase51-v1';

/**
 * Self-serve, pull-only per-owner TREND CHART series built by reusing the
 * existing Phase 50 week-over-week trend snapshots. Returns rows ONLY when
 * the owner is currently opted in AND the caller is the owner themselves or
 * a firm-wide actor — identical gating to
 * listSloOwnerDigestSelfServeFailuresPhase50. Still pull-only / NOT a full
 * push notification system: nothing is pushed, the caller must explicitly
 * request the chart.
 */
export async function listSloOwnerDigestSelfServeTrendPhase51(input: {
  ownerId: string;
  actorId: string;
  weeks?: number;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'list_slo_owner_digest_self_serve_trend_phase51',
    {
      p_owner_id: input.ownerId,
      p_actor_id: input.actorId,
      p_weeks: input.weeks ?? 8,
    },
  );
  if (error) return { ok: false as const, error: error.message };
  return {
    ok: true as const,
    detail: (data as Record<string, unknown> | null) ?? undefined,
  };
}

export async function getSloPhase51OwnerDigestReport() {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('get_slo_phase51_owner_digest_report');
  if (error) {
    console.error(
      'slo phase51 owner digest report unavailable',
      error.message,
    );
    return null;
  }
  return data;
}

export async function processSloGovernancePhase51() {
  // Phase 51 SLO governance is pull-only: it only ever reuses existing
  // Phase 50 WoW trend snapshots when an owner or firm-wide admin explicitly
  // requests their chart. There is no periodic tick to run here — nothing
  // is pushed, and this function intentionally does no work on its own.
  return {
    full_push: false,
    contract_version: PHASE51_SLO_CONTRACT_VERSION,
  };
}
