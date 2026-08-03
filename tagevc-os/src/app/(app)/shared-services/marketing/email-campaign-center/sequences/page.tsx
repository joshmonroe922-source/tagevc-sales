import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import { campaignDb } from '@/lib/campaign/db/client';
import { starterPacksForEntity } from '@/lib/campaign/core/journey-graph';
import { SequencesClient } from '@/components/campaign/sequences-client';

export default async function Page() {
  await requirePermission('read:marketing');
  const ctx = await getSessionContext();
  const entityId = ctx?.profile.entity_id || 'ENT-FIRM';
  const sb = await campaignDb();

  let rows: Array<{
    id: string;
    name: string;
    journey_type: string;
    status: string;
    mutex_group: string | null;
    starter_pack_key?: string | null;
    updated_at?: string;
    graph_json?: { nodes?: unknown[] };
  }> = [];

  const full = await sb
    .from('ecc_journeys')
    .select('id, name, journey_type, status, mutex_group, starter_pack_key, updated_at, graph_json')
    .eq('entity_id', entityId)
    .order('updated_at', { ascending: false });
  if (full.error) {
    const basic = await sb
      .from('ecc_journeys')
      .select('id, name, journey_type, status, mutex_group, updated_at, graph_json')
      .eq('entity_id', entityId)
      .order('updated_at', { ascending: false });
    rows = (basic.data ?? []).map((r) => ({ ...r, starter_pack_key: null }));
  } else {
    rows = full.data ?? [];
  }

  const packs = starterPacksForEntity(entityId).map((p) => ({
    key: p.id,
    name: p.name,
    description: p.description,
    mutexGroup: p.mutex_group,
  }));

  return <SequencesClient journeys={rows} packs={packs} />;
}
