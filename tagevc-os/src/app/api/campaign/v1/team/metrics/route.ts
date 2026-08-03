import { requireCampaignAuth } from '@/lib/campaign/auth';
import { campaignDb } from '@/lib/campaign/db/client';
import { jsonError, jsonOk } from '@/lib/campaign/http';

export async function GET() {
  try {
    const auth = await requireCampaignAuth();
    if (!auth.permissions.viewTeam) {
      return jsonError('FORBIDDEN', 'view_team required', 403);
    }
    const sb = await campaignDb();
    const { data } = await sb
      .from('ecc_campaigns')
      .select('owner_id, status, stats_json')
      .eq('entity_id', auth.entityId)
      .limit(500);
    const byUser = new Map<string, { sends: number; campaigns: number }>();
    for (const c of data ?? []) {
      const key = c.owner_id || 'unassigned';
      const cur = byUser.get(key) || { sends: 0, campaigns: 0 };
      cur.campaigns += 1;
      const stats = (c.stats_json || {}) as { sent?: number };
      cur.sends += stats.sent || 0;
      byUser.set(key, cur);
    }
    return jsonOk({
      data: [...byUser.entries()].map(([user_id, m]) => ({ user_id, ...m })),
    });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
