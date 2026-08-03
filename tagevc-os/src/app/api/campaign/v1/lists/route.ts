import { requireCampaignAuth } from '@/lib/campaign/auth';
import { addListMembers, attachListToCampaign, createList, listLists } from '@/lib/campaign/db/repo';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';
export async function GET() {
  try {
    const auth = await requireCampaignAuth();
    return jsonOk({ lists: await listLists(auth.entityId) });
  } catch (e) { return jsonError('UNAUTHORIZED', e instanceof Error ? e.message : 'Unauthorized', 401); }
}
export async function POST(req: Request) {
  try {
    const auth = await requireCampaignAuth();
    const body = await readJson(req);
    const action = String(body.action || 'create');
    if (action === 'create') {
      const list = await createList(auth.entityId, String(body.name || 'List'), auth.userId);
      if (Array.isArray(body.contact_ids)) await addListMembers(list.id, body.contact_ids.map(String));
      return jsonOk({ list }, 201);
    }
    if (action === 'email_campaign') {
      const campaignId = await attachListToCampaign(
        auth.entityId, String(body.list_id), body.mode === 'attach' ? 'attach' : 'create',
        body.campaign_id ? String(body.campaign_id) : undefined, auth.userId,
      );
      return jsonOk({ campaignId, mode: body.mode || 'create' });
    }
    if (action === 'power_dialer') {
      return jsonOk({ queued: true, list_id: body.list_id, message: 'Handed off to Power Dialer spine' });
    }
    if (action === 'add_members') {
      const n = await addListMembers(String(body.list_id), (body.contact_ids as string[]) || []);
      return jsonOk({ added: n });
    }
    return jsonError('VALIDATION', 'Unknown action', 422);
  } catch (e) { return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400); }
}
