import { requireCampaignAuth } from '@/lib/campaign/auth';
import { campaignDb } from '@/lib/campaign/db/client';
import { previewSegment } from '@/lib/campaign/db/repo';
import { jsonError, jsonOk } from '@/lib/campaign/http';
import type { SegmentDefinition } from '@/lib/campaign/core/types';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const auth = await requireCampaignAuth();
    const sb = await campaignDb();
    const { data: seg } = await sb
      .from('ecc_segments')
      .select('definition_json')
      .eq('id', id)
      .eq('entity_id', auth.entityId)
      .maybeSingle();
    if (!seg) return jsonError('NOT_FOUND', 'Segment not found', 404);
    const result = await previewSegment(
      auth.entityId,
      seg.definition_json as SegmentDefinition,
    );
    return jsonOk({ data: result });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
