import { requireCampaignAuth } from '@/lib/campaign/auth';
import { createSegment, listSegments } from '@/lib/campaign/db/repo';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';
import type { SegmentDefinition } from '@/lib/campaign/core/types';

export async function GET() {
  try {
    const auth = await requireCampaignAuth();
    return jsonOk({ data: await listSegments(auth.entityId) });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireCampaignAuth();
    const body = await readJson<{
      name?: string;
      definition_json?: SegmentDefinition;
    }>(req);
    if (!body.name?.trim()) return jsonError('VALIDATION', 'name required');
    const row = await createSegment(auth.entityId, {
      name: body.name,
      definition_json: body.definition_json || { op: 'and', rules: [] },
      created_by: auth.userId,
    });
    return jsonOk({ data: row }, 201);
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
