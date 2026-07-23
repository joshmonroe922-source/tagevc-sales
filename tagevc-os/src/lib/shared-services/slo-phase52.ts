import { createPersistClient } from '@/lib/supabase/persist-client';

export const PHASE52_SLO_CONTRACT_VERSION = 'phase52-v1';

/**
 * Firm-wide (not just self-serve, opt-in) admin summary trend view for
 * digest delivery health. Still pull-only / NOT a full push notification
 * system: admins must explicitly request the view; nothing is pushed.
 */
export async function listSloFirmDigestAdminSummaryTrendPhase52(input?: {
  weeks?: number;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'list_slo_firm_digest_admin_summary_trend_phase52',
    { p_weeks: input?.weeks ?? 8 },
  );
  if (error) return { ok: false as const, error: error.message };
  return {
    ok: true as const,
    detail: (data as Record<string, unknown> | null) ?? undefined,
  };
}

export async function getSloPhase52FirmDigestAdminReport() {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'get_slo_phase52_firm_digest_admin_report',
  );
  if (error) {
    console.error(
      'slo phase52 firm digest admin report unavailable',
      error.message,
    );
    return null;
  }
  return data;
}

export async function processSloGovernancePhase52() {
  // Pull-only firm-wide admin summary: record one trend point when the
  // evaluate tick runs (service-role), but never push digests to owners.
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc(
      'record_slo_firm_digest_admin_summary_trend_phase52',
      { p_actor_id: null },
    );
    if (error) {
      return {
        ok: false as const,
        full_push: false,
        contract_version: PHASE52_SLO_CONTRACT_VERSION,
        error: error.message,
      };
    }
    return {
      ok: true as const,
      full_push: false,
      contract_version: PHASE52_SLO_CONTRACT_VERSION,
      summary: data as Record<string, unknown>,
    };
  } catch (caught) {
    return {
      ok: false as const,
      full_push: false,
      contract_version: PHASE52_SLO_CONTRACT_VERSION,
      error:
        caught instanceof Error
          ? caught.message
          : 'Phase 52 SLO governance failed',
    };
  }
}
