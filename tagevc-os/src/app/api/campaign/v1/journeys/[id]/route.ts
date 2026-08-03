import { requireCampaignAuth } from '@/lib/campaign/auth';
import { getJourney, updateJourney } from '@/lib/campaign/db/repo';
import { normalizeJourneyGraph, validateJourneyGraph } from '@/lib/campaign/core/journey-graph';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCampaignAuth();
    const { id } = await ctx.params;
    const data = await getJourney(auth.entityId, id);
    if (!data) return jsonError('NOT_FOUND', 'Journey not found', 404);
    return jsonOk({ data, validation: validateJourneyGraph(normalizeJourneyGraph(data.graph_json)) });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCampaignAuth();
    if (!auth.permissions.marketer) return jsonError('FORBIDDEN', 'Marketer role required', 403);
    const { id } = await ctx.params;
    const body = await readJson<{
      name?: string;
      status?: string;
      graph_json?: unknown;
      mutex_group?: string | null;
      goal_json?: unknown;
      trigger_json?: unknown;
      default_delivery_plane?: string;
    }>(req);
    const existing = await getJourney(auth.entityId, id);
    if (!existing) return jsonError('NOT_FOUND', 'Journey not found', 404);

    const patch: Record<string, unknown> = {};
    if (body.name != null) patch.name = body.name;
    if (body.status != null) patch.status = body.status;
    if (body.mutex_group !== undefined) patch.mutex_group = body.mutex_group;
    if (body.goal_json != null) patch.goal_json = body.goal_json;
    if (body.trigger_json != null) patch.trigger_json = body.trigger_json;
    if (body.default_delivery_plane != null) patch.default_delivery_plane = body.default_delivery_plane;
    if (body.graph_json != null) {
      const graph = normalizeJourneyGraph(body.graph_json);
      const v = validateJourneyGraph(graph);
      if (!v.ok) {
        return jsonError('VALIDATION', v.errors[0] || 'Invalid graph', 400, {
          errors: v.errors,
          warnings: v.warnings,
        });
      }
      patch.graph_json = graph;
      if (existing.version != null) patch.version = Number(existing.version || 1) + 1;
    }

    try {
      const data = await updateJourney(auth.entityId, id, patch);
      return jsonOk({
        data,
        validation: validateJourneyGraph(normalizeJourneyGraph(data.graph_json)),
      });
    } catch (err) {
      if (patch.version != null) {
        delete patch.version;
        const data = await updateJourney(auth.entityId, id, patch);
        return jsonOk({
          data,
          validation: validateJourneyGraph(normalizeJourneyGraph(data.graph_json)),
        });
      }
      throw err;
    }
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
