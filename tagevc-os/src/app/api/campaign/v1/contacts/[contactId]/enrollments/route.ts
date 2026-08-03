import { requireCampaignAuth } from '@/lib/campaign/auth';
import { enrollContact } from '@/lib/campaign/db/repo';
import { campaignDb } from '@/lib/campaign/db/client';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';

type Ctx = { params: Promise<{ contactId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { contactId } = await ctx.params;
    const auth = await requireCampaignAuth();
    const sb = await campaignDb();
    const { data } = await sb
      .from('ecc_journey_enrollments')
      .select('*, ecc_journeys(name, journey_type, status)')
      .eq('entity_id', auth.entityId)
      .eq('contact_id', contactId)
      .order('entered_at', { ascending: false });
    return jsonOk({ data: data ?? [] });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { contactId } = await ctx.params;
    const auth = await requireCampaignAuth();
    const body = await readJson<{ journey_id?: string }>(req);
    if (!body.journey_id) return jsonError('VALIDATION', 'journey_id required');
    const row = await enrollContact({
      entityId: auth.entityId,
      contactId,
      journeyId: body.journey_id,
      ownerId: auth.userId,
      source: 'contact_ui',
    });
    return jsonOk({ data: row }, 201);
  } catch (e) {
    const err = e as Error & { status?: number; details?: unknown };
    return jsonError(
      err.status === 409 ? 'CONFLICT' : 'ERROR',
      err.message,
      err.status || 400,
      err.details,
    );
  }
}
