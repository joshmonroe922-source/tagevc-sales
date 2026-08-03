import { requireCampaignAuth, isCampaignEnabled } from '@/lib/campaign/auth';
import { createCampaign, listCampaigns } from '@/lib/campaign/db/repo';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const auth = await requireCampaignAuth({ entityOverride: url.searchParams.get('entity_id') });
    if (!(await isCampaignEnabled(auth.entityId))) return jsonError('DISABLED', 'Disabled', 403);
    const campaigns = await listCampaigns(auth.entityId, {
      status: url.searchParams.get('status') || undefined,
      q: url.searchParams.get('q') || undefined,
      attachable: url.searchParams.get('attachable') === 'true',
    });
    return jsonOk({ campaigns });
  } catch (e) { return jsonError('UNAUTHORIZED', e instanceof Error ? e.message : 'Unauthorized', 401); }
}
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const auth = await requireCampaignAuth({ entityOverride: typeof body.entity_id === 'string' ? body.entity_id : null });
    if (!auth.permissions.marketer) return jsonError('FORBIDDEN', 'Marketer required', 403);
    const name = String(body.name || '').trim();
    if (!name) return jsonError('VALIDATION', 'name required', 422);
    const campaign = await createCampaign(auth.entityId, {
      name, subject: body.subject, body_html: body.body_html, template_id: body.template_id,
      audience_type: body.audience_type, audience_id: body.audience_id,
      delivery_plane: body.delivery_plane || 'controlled_graph', created_by: auth.userId,
    });
    return jsonOk({ campaign }, 201);
  } catch (e) { return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400); }
}
