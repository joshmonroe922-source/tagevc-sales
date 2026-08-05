import { requireCampaignAuth } from '@/lib/campaign/auth';
import { enrollContact } from '@/lib/campaign/db/repo';
import {
  exitEnrollment,
  pauseEnrollment,
} from '@/lib/campaign/enrollment';
import { campaignDb } from '@/lib/campaign/db/client';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';

type Ctx = { params: Promise<{ contactId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const { contactId } = await ctx.params;
    const auth = await requireCampaignAuth(req);
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
    const auth = await requireCampaignAuth(req);
    const body = await readJson<{
      journey_id?: string;
      source?: string;
      context?: Record<string, unknown>;
      metadata_json?: Record<string, unknown>;
    }>(req);
    if (!body.journey_id) return jsonError('VALIDATION', 'journey_id required');
    const metadata = body.metadata_json || body.context || null;
    const row = await enrollContact({
      entityId: auth.entityId,
      contactId,
      journeyId: body.journey_id,
      ownerId: auth.userId,
      source: body.source || 'contact_ui',
      metadata,
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

/** Pause or exit a single enrollment (R619 CRM EnrollmentService). */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { contactId } = await ctx.params;
    const auth = await requireCampaignAuth(req);
    const body = await readJson<{
      enrollment_id?: string;
      action?: 'pause' | 'exit';
      reason?: string;
    }>(req);
    if (!body.enrollment_id || !body.action) {
      return jsonError('VALIDATION', 'enrollment_id and action required');
    }
    const sb = await campaignDb();
    const { data: row } = await sb
      .from('ecc_journey_enrollments')
      .select('id')
      .eq('id', body.enrollment_id)
      .eq('contact_id', contactId)
      .eq('entity_id', auth.entityId)
      .maybeSingle();
    if (!row) return jsonError('NOT_FOUND', 'Enrollment not found', 404);

    const reason = body.reason || body.action;
    if (body.action === 'pause') {
      await pauseEnrollment(body.enrollment_id, reason);
    } else {
      await exitEnrollment(body.enrollment_id, reason);
    }
    return jsonOk({ data: { ok: true, action: body.action } });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
