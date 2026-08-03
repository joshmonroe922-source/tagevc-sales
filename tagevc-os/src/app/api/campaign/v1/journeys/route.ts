import { requireCampaignAuth } from '@/lib/campaign/auth';
import { campaignDb } from '@/lib/campaign/db/client';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';

export async function GET() {
  try {
    const auth = await requireCampaignAuth();
    const sb = await campaignDb();
    const { data } = await sb
      .from('ecc_journeys')
      .select('*')
      .eq('entity_id', auth.entityId)
      .order('updated_at', { ascending: false });
    return jsonOk({ data: data ?? [] });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireCampaignAuth();
    const body = await readJson<{
      name?: string;
      journey_type?: string;
      mutex_group?: string;
      default_delivery_plane?: string;
      graph_json?: unknown;
    }>(req);
    if (!body.name?.trim()) return jsonError('VALIDATION', 'name required');
    const sb = await campaignDb();
    const { data, error } = await sb
      .from('ecc_journeys')
      .insert({
        entity_id: auth.entityId,
        name: body.name,
        journey_type: body.journey_type || 'sequence',
        mutex_group: body.mutex_group || null,
        default_delivery_plane: body.default_delivery_plane || 'graph',
        graph_json: body.graph_json || { nodes: [], edges: [] },
        created_by: auth.userId,
        owner_id: auth.userId,
        status: 'draft',
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return jsonOk({ data }, 201);
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
