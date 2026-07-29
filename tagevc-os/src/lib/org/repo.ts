import { createClient } from '@/lib/supabase/server';
import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  buildOrgForest,
  filterProfilesForViewer,
  type OrgProfileNode,
  type OrgTreeNode,
  canEditOrgSpine,
} from '@/lib/org/tree';
import { normalizeEntityId } from '@/lib/entities/display-name';
import { CONSOLIDATED_SELECT_VALUE } from '@/lib/entities/display-order';

const ORG_SELECT =
  'id, email, full_name, job_title, role, entity_id, manager_profile_id, avatar_url, active';

function mapRow(row: Record<string, unknown>): OrgProfileNode {
  return {
    id: String(row.id),
    email: String(row.email ?? ''),
    full_name: (row.full_name as string | null) ?? null,
    job_title: (row.job_title as string | null) ?? null,
    role: String(row.role ?? 'associate'),
    entity_id: (row.entity_id as string | null) ?? null,
    manager_profile_id: (row.manager_profile_id as string | null) ?? null,
    avatar_url: (row.avatar_url as string | null) ?? null,
    active: row.active !== false,
  };
}

export async function listOrgProfiles(): Promise<{
  ok: boolean;
  profiles: OrgProfileNode[];
  error?: string;
  tableReady: boolean;
}> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('profiles')
      .select(ORG_SELECT)
      .eq('active', true)
      .order('full_name', { ascending: true });

    if (error) {
      if (/job_title|manager_profile_id/i.test(error.message)) {
        const retry = await supabase
          .from('profiles')
          .select('id, email, full_name, role, entity_id, avatar_url, active')
          .eq('active', true)
          .order('full_name', { ascending: true });
        if (retry.error) {
          return {
            ok: false,
            profiles: [],
            error: retry.error.message,
            tableReady: false,
          };
        }
        return {
          ok: true,
          profiles: (retry.data ?? []).map((r) =>
            mapRow({ ...r, job_title: null, manager_profile_id: null }),
          ),
          tableReady: false,
        };
      }
      return {
        ok: false,
        profiles: [],
        error: error.message,
        tableReady: false,
      };
    }

    return {
      ok: true,
      profiles: (data ?? []).map((r) => mapRow(r as Record<string, unknown>)),
      tableReady: true,
    };
  } catch (e) {
    return {
      ok: false,
      profiles: [],
      error: e instanceof Error ? e.message : 'Failed to load org',
      tableReady: false,
    };
  }
}

export async function loadOrgChartForViewer(input: {
  viewer: { id: string; role: string; entity_id: string | null };
  scope?: string | null;
  zoomRootId?: string | null;
}): Promise<{
  forest: OrgTreeNode[];
  profiles: OrgProfileNode[];
  canEdit: boolean;
  tableReady: boolean;
  scope: string;
  isConsolidated: boolean;
  error?: string;
}> {
  const raw = (input.scope ?? '').trim();
  const isConsolidated =
    !raw || raw === CONSOLIDATED_SELECT_VALUE || raw === 'all';
  const entityScope = isConsolidated
    ? null
    : normalizeEntityId(raw) || raw;

  const listed = await listOrgProfiles();
  const visible = filterProfilesForViewer(listed.profiles, input.viewer, {
    entityScope,
    consolidated: isConsolidated && FIRM_VIEW(input.viewer.role),
  });

  // Non-firm roles: always entity-home scoped even if consolidated requested
  const forest = buildOrgForest(visible, input.zoomRootId ?? null);

  return {
    forest,
    profiles: visible,
    canEdit: canEditOrgSpine(input.viewer.role),
    tableReady: listed.tableReady,
    scope: isConsolidated ? CONSOLIDATED_SELECT_VALUE : entityScope!,
    isConsolidated:
      isConsolidated &&
      (FIRM_VIEW(input.viewer.role) || input.viewer.role === 'admin'),
    error: listed.error,
  };
}

function FIRM_VIEW(role: string): boolean {
  return ['visionary', 'partner', 'coo', 'admin', 'ssc_hr', 'ssc_finance'].includes(
    role,
  );
}

export async function updateProfileOrgFields(input: {
  profileId: string;
  managerProfileId?: string | null;
  jobTitle?: string | null;
  actorRole: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!canEditOrgSpine(input.actorRole)) {
    return { ok: false, error: 'Admin or HR required to edit org chart.' };
  }
  try {
    const sb = await createPersistClient();
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (input.managerProfileId !== undefined) {
      patch.manager_profile_id = input.managerProfileId;
    }
    if (input.jobTitle !== undefined) {
      patch.job_title = input.jobTitle?.trim() || null;
    }
    const { error } = await sb
      .from('profiles')
      .update(patch)
      .eq('id', input.profileId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Update failed',
    };
  }
}

/** Sync portal profile reports-to + title when HRIS hire sets manager. */
export async function syncProfileFromHire(input: {
  profileId: string | null | undefined;
  managerProfileId: string | null;
  jobTitle?: string | null;
}): Promise<void> {
  if (!input.profileId) return;
  try {
    const sb = await createPersistClient();
    await sb
      .from('profiles')
      .update({
        manager_profile_id: input.managerProfileId,
        job_title: input.jobTitle?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.profileId);
  } catch {
    /* soft */
  }
}
