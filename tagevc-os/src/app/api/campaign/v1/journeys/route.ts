import { requireCampaignAuth } from '@/lib/campaign/auth';
import { createJourney, listJourneys } from '@/lib/campaign/db/repo';
import {
  emptyJourneyGraph,
  layoutJourneyGraph,
  normalizeJourneyGraph,
} from '@/lib/campaign/core/journey-graph';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';

/** List journeys for entity — ECC UI + Recruit 619 Engage / EnrollmentService. */
export async function GET(req: Request) {
  try {
    const auth = await requireCampaignAuth(req);
    return jsonOk({ data: await listJourneys(auth.entityId) });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireCampaignAuth(req);
    if (!auth.permissions.marketer) {
      return jsonError('FORBIDDEN', 'Marketer role required', 403);
    }
    const body = await readJson<{
      name?: string;
      journey_type?: string;
      mutex_group?: string;
      default_delivery_plane?: string;
      graph_json?: unknown;
      starter_pack_key?: string;
      trigger_json?: unknown;
      goal_json?: unknown;
    }>(req);
    if (!body.name?.trim()) return jsonError('VALIDATION', 'name required');
    const graph = body.graph_json
      ? layoutJourneyGraph(normalizeJourneyGraph(body.graph_json))
      : layoutJourneyGraph(emptyJourneyGraph());
    const data = await createJourney(auth.entityId, {
      name: body.name,
      journey_type: body.journey_type || 'sequence',
      mutex_group: body.mutex_group || null,
      default_delivery_plane: body.default_delivery_plane || 'graph',
      graph_json: graph,
      starter_pack_key: body.starter_pack_key || null,
      trigger_json: body.trigger_json || { type: 'manual' },
      goal_json: body.goal_json || {},
      created_by: auth.userId,
      status: 'draft',
    });
    return jsonOk({ data }, 201);
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
