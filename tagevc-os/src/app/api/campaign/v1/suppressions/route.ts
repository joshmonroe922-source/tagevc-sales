import { requireCampaignAuth } from '@/lib/campaign/auth';
import { addSuppression } from '@/lib/campaign/db/repo';
import { campaignDb } from '@/lib/campaign/db/client';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';

export async function GET() {
  try {
    const auth = await requireCampaignAuth();
    const sb = await campaignDb();
    const { data } = await sb
      .from('ecc_suppressions')
      .select('*')
      .eq('entity_id', auth.entityId)
      .order('created_at', { ascending: false })
      .limit(200);
    return jsonOk({ data: data ?? [] });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireCampaignAuth();
    const body = await readJson<{ email?: string; reason?: string }>(req);
    if (!body.email) return jsonError('VALIDATION', 'email required');
    const row = await addSuppression(
      auth.entityId,
      body.email,
      body.reason || 'manual',
      'api',
    );
    return jsonOk({ data: row }, 201);
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
