import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  mapProfileToRosterPerson,
  type HrRosterPerson,
} from '@/lib/shared-services/hr-ops-phase62';
import { listOnboardingCandidateTickets, listOnboardingRuns } from '@/lib/shared-services/it-onboarding';
import {
  listOffboardingCandidateTickets,
  listOffboardingRuns,
} from '@/lib/shared-services/it-offboarding';

export async function listHrRosterPhase62(opts?: {
  entityId?: string | null;
  limit?: number;
}): Promise<{ people: HrRosterPerson[]; error?: string }> {
  const limit = opts?.limit ?? 80;
  try {
    const sb = await createPersistClient();
    let q = sb
      .from('profiles')
      .select('id, email, full_name, role, entity_id, active, updated_at')
      .order('full_name', { ascending: true, nullsFirst: false })
      .limit(limit);
    if (opts?.entityId) {
      q = q.eq('entity_id', opts.entityId);
    }
    const { data, error } = await q;
    if (error) return { people: [], error: error.message };
    return {
      people: (data ?? []).map((row) =>
        mapProfileToRosterPerson(row as Record<string, unknown> as {
          id: string;
          email: string;
          full_name?: string | null;
          role?: string | null;
          entity_id?: string | null;
          active?: boolean | null;
          updated_at?: string | null;
        }),
      ),
    };
  } catch (e) {
    return {
      people: [],
      error: e instanceof Error ? e.message : 'Roster unavailable',
    };
  }
}

export async function getHrOpsBundlePhase62(opts?: {
  entityId?: string | null;
}) {
  const entityId = opts?.entityId ?? null;
  const [roster, onboarding, offboarding] = await Promise.all([
    listHrRosterPhase62({ entityId }),
    listOnboardingRuns(12, entityId),
    listOffboardingRuns(12, entityId),
  ]);
  return {
    roster: roster.people,
    rosterError: roster.error,
    onboardingRuns: onboarding.rows,
    onboardingError: onboarding.error,
    offboardingRuns: offboarding.rows,
    offboardingError: offboarding.error,
    onboardingCandidates: listOnboardingCandidateTickets(entityId),
    offboardingCandidates: listOffboardingCandidateTickets(entityId),
  };
}

export async function seedFinanceYearEndChecklistPhase62(opts?: {
  actorId?: string | null;
  entityId?: string | null;
}): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc('seed_finance_year_end_checklist_phase62', {
      p_actor_id: opts?.actorId ?? null,
      p_entity_id: opts?.entityId ?? null,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: (data ?? {}) as Record<string, unknown> };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Year-end seed failed',
    };
  }
}
