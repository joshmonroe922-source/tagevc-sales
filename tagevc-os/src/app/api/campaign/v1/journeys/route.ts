import { requireCampaignAuth } from '@/lib/campaign/auth';
import { campaignDb } from '@/lib/campaign/db/client';
import { jsonError, jsonOk } from '@/lib/campaign/http';

/** List journeys for entity — used by Recruit 619 Engage / EnrollmentService. */
export async function GET(req: Request) {
  try {
    const auth = await requireCampaignAuth(req);
    const sb = await campaignDb();
    const { data, error } = await sb
      .from('ecc_journeys')
      .select('id, name, journey_type, status, updated_at, created_at')
      .eq('entity_id', auth.entityId)
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return jsonOk({ data: data ?? [] });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
