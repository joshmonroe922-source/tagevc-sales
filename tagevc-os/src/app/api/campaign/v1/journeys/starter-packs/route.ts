import { requireCampaignAuth } from '@/lib/campaign/auth';
import { createJourney } from '@/lib/campaign/db/repo';
import {
  getStarterPack,
  starterPacksForEntity,
} from '@/lib/campaign/core/journey-graph';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';

export async function GET() {
  try {
    const auth = await requireCampaignAuth();
    const packs = starterPacksForEntity(auth.entityId).map((p) => ({
      key: p.id,
      name: p.name,
      description: p.description,
      mutexGroup: p.mutex_group,
      journeyType: p.journey_type,
    }));
    return jsonOk({ data: packs });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireCampaignAuth();
    if (!auth.permissions.marketer) return jsonError('FORBIDDEN', 'Marketer role required', 403);
    const body = await readJson<{ pack_key?: string }>(req);
    const pack = body.pack_key ? getStarterPack(body.pack_key) : null;
    if (!pack) return jsonError('NOT_FOUND', 'Unknown starter pack', 404);
    if (
      auth.entityId !== 'ENT-FIRM' &&
      !pack.entityIds.includes(auth.entityId) &&
      pack.entityIds.length > 0
    ) {
      return jsonError('FORBIDDEN', 'Pack not available for this entity', 403);
    }

    const data = await createJourney(auth.entityId, {
      name: pack.name,
      journey_type: pack.journey_type,
      mutex_group: pack.mutex_group,
      default_delivery_plane: pack.default_delivery_plane,
      graph_json: pack.graph,
      starter_pack_key: pack.id,
      trigger_json: pack.graph.nodes.find((n) => n.type === 'trigger')?.config || {
        type: 'manual',
      },
      goal_json: pack.graph.nodes.find((n) => n.type === 'goal')?.config || {},
      created_by: auth.userId,
      status: 'draft',
    });
    return jsonOk({ data }, 201);
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
