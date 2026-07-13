import { requireSupabase } from './supabase';
import type { OpsEntity } from './opsTypes';

/** All entities for admin assignment UI (RLS: admins see everything). */
export async function fetchAllEntitiesForAdmin(): Promise<
  Pick<OpsEntity, 'id' | 'name' | 'slug' | 'entity_type' | 'status' | 'website_url'>[]
> {
  const { data, error } = await requireSupabase()
    .from('ops_entities')
    .select('id, name, slug, entity_type, status, website_url')
    .order('name');
  if (error) throw new Error(error.message);
  return (data ?? []) as Pick<
    OpsEntity,
    'id' | 'name' | 'slug' | 'entity_type' | 'status' | 'website_url'
  >[];
}

export async function fetchEntityAssignmentsForUser(userId: string): Promise<string[]> {
  const { data, error } = await requireSupabase()
    .from('ops_entity_assignments')
    .select('entity_id')
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.entity_id as string);
}

export async function setUserEntityAssignment(
  userId: string,
  entityId: string,
  assigned: boolean,
  assignedBy: string | null,
): Promise<void> {
  const client = requireSupabase();

  if (assigned) {
    const { error } = await client.from('ops_entity_assignments').upsert(
      {
        user_id: userId,
        entity_id: entityId,
        assigned_by: assignedBy,
      },
      { onConflict: 'user_id,entity_id' },
    );
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await client
    .from('ops_entity_assignments')
    .delete()
    .eq('user_id', userId)
    .eq('entity_id', entityId);
  if (error) throw new Error(error.message);
}
