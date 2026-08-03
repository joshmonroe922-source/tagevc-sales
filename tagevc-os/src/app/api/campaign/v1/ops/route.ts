import { NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/rbac/session';
import { isCampaignEnabled } from '@/lib/campaign/flags';
import {
  addSuppression,
  checkSuppressionsBatch,
  recordConsent,
} from '@/lib/campaign/consent';
import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  estimateSegmentCount,
  parseSegmentDefinition,
  type SegmentContact,
} from '@/lib/campaign/segment-dsl';
import { getAnalyticsOverview, getCampaignRecipients } from '@/lib/campaign/repo';
import {
  bulkEnroll,
  enrollContact,
  exitEnrollment,
  pauseAllCadencesForContact,
  pauseEnrollment,
} from '@/lib/campaign/enrollment';
import { recordDialerAttempt } from '@/lib/campaign/dialer';
import { queueSendEnvelope } from '@/lib/campaign/docusign-port';
import { setKillSwitch, getEntitySettings } from '@/lib/campaign/flags';
import { apiError } from '@/lib/campaign/types';

export const runtime = 'nodejs';

async function ctx() {
  const session = await getSessionContext();
  if (!session) return null;
  const entityId = session.profile.entity_id || 'ENT-FIRM';
  if (!(await isCampaignEnabled(entityId))) return null;
  return { session, entityId };
}

/**
 * Multiplexed ops route — ?resource=
 * suppressions | segments | analytics | enrollments | dialer | docusign | settings | team
 */
export async function GET(req: Request) {
  const c = await ctx();
  if (!c) {
    return NextResponse.json(apiError('UNAUTHORIZED', 'Unauthorized'), { status: 401 });
  }
  const url = new URL(req.url);
  const resource = url.searchParams.get('resource') || 'analytics';

  if (resource === 'analytics') {
    const overview = await getAnalyticsOverview(c.entityId);
    return NextResponse.json({ ok: true, overview });
  }

  if (resource === 'recipients') {
    const campaignId = url.searchParams.get('campaign_id');
    if (!campaignId) {
      return NextResponse.json(apiError('VALIDATION', 'campaign_id required'), { status: 422 });
    }
    const recipients = await getCampaignRecipients(campaignId, {
      sort: (url.searchParams.get('sort') as 'score') || 'score',
      filter: url.searchParams.get('filter') || undefined,
    });
    return NextResponse.json({ ok: true, recipients });
  }

  if (resource === 'suppressions') {
    const sb = await createPersistClient({ mode: 'service' });
    const { data } = await sb
      .from('ecc_suppressions')
      .select('*')
      .eq('entity_id', c.entityId)
      .order('created_at', { ascending: false })
      .limit(200);
    return NextResponse.json({ ok: true, suppressions: data ?? [] });
  }

  if (resource === 'segments') {
    const sb = await createPersistClient({ mode: 'service' });
    const { data } = await sb
      .from('ecc_segments')
      .select('*')
      .eq('entity_id', c.entityId)
      .order('updated_at', { ascending: false });
    return NextResponse.json({ ok: true, segments: data ?? [] });
  }

  if (resource === 'settings') {
    const settings = await getEntitySettings(c.entityId);
    return NextResponse.json({ ok: true, settings });
  }

  if (resource === 'team') {
    const sb = await createPersistClient({ mode: 'service' });
    const { data } = await sb
      .from('ecc_campaigns')
      .select('id, name, status, owner_id, stats_json, updated_at')
      .eq('entity_id', c.entityId)
      .order('updated_at', { ascending: false })
      .limit(50);
    return NextResponse.json({
      ok: true,
      campaigns: data ?? [],
      scope: 'entity',
    });
  }

  if (resource === 'enrollments') {
    const contactId = url.searchParams.get('contact_id');
    if (!contactId) {
      return NextResponse.json(apiError('VALIDATION', 'contact_id required'), { status: 422 });
    }
    const sb = await createPersistClient({ mode: 'service' });
    const { data } = await sb
      .from('ecc_journey_enrollments')
      .select('*, ecc_journeys(name, journey_type, status)')
      .eq('contact_id', contactId)
      .eq('entity_id', c.entityId)
      .order('entered_at', { ascending: false });
    return NextResponse.json({ ok: true, enrollments: data ?? [] });
  }

  return NextResponse.json(apiError('VALIDATION', 'Unknown resource'), { status: 422 });
}

export async function POST(req: Request) {
  const c = await ctx();
  if (!c) {
    return NextResponse.json(apiError('UNAUTHORIZED', 'Unauthorized'), { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(apiError('VALIDATION', 'Invalid JSON'), { status: 400 });
  }
  const resource = String(body.resource || '');

  if (resource === 'suppressions') {
    if (body.action === 'check') {
      const emails = Array.isArray(body.emails)
        ? (body.emails as string[]).map(String)
        : [];
      const results = await checkSuppressionsBatch(c.entityId, emails);
      return NextResponse.json({ ok: true, results });
    }
    await addSuppression({
      entityId: c.entityId,
      email: String(body.email || ''),
      reason: (body.reason as 'manual') || 'manual',
      source: 'manual',
    });
    return NextResponse.json({ ok: true });
  }

  if (resource === 'consent') {
    await recordConsent({
      entityId: c.entityId,
      contactId: body.contact_id ? String(body.contact_id) : null,
      email: String(body.email || ''),
      status: (body.status as 'opt_out') || 'opt_out',
      source: String(body.source || 'manual'),
    });
    return NextResponse.json({ ok: true });
  }

  if (resource === 'segments') {
    if (body.action === 'preview') {
      const def = parseSegmentDefinition(body.definition_json);
      const sb = await createPersistClient({ mode: 'service' });
      const { data } = await sb
        .from('contacts')
        .select(
          'id, primary_email, first_name, last_name, full_name, title, lifecycle, email_permission, engagement_score',
        )
        .limit(500);
      const result = estimateSegmentCount(
        def,
        (data ?? []) as SegmentContact[],
      );
      return NextResponse.json({ ok: true, ...result });
    }
    const sb = await createPersistClient({ mode: 'service' });
    const { data, error } = await sb
      .from('ecc_segments')
      .insert({
        entity_id: c.entityId,
        name: String(body.name || 'Segment'),
        definition_json: body.definition_json ?? { op: 'and', rules: [] },
        created_by: c.session.profile.id,
      })
      .select('*')
      .single();
    if (error) {
      return NextResponse.json(apiError('VALIDATION', error.message), { status: 422 });
    }
    return NextResponse.json({ ok: true, segment: data }, { status: 201 });
  }

  if (resource === 'enrollments') {
    if (body.action === 'bulk') {
      const result = await bulkEnroll({
        entityId: c.entityId,
        contactIds: (body.contact_ids as string[]) || [],
        journeyId: String(body.journey_id || ''),
        actorId: c.session.profile.id,
        ownerId: c.session.profile.id,
      });
      return NextResponse.json({ ok: true, ...result });
    }
    if (body.action === 'pause') {
      await pauseEnrollment(String(body.enrollment_id), String(body.reason || 'manual'));
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'exit') {
      await exitEnrollment(String(body.enrollment_id), String(body.reason || 'manual'));
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'conversation_pause') {
      const n = await pauseAllCadencesForContact({
        entityId: c.entityId,
        contactId: String(body.contact_id),
        reason: String(body.reason || 'manual'),
        actorId: c.session.profile.id,
      });
      return NextResponse.json({ ok: true, paused: n });
    }
    const result = await enrollContact({
      entityId: c.entityId,
      contactId: String(body.contact_id),
      journeyId: String(body.journey_id),
      actorId: c.session.profile.id,
      ownerId: c.session.profile.id,
      source: String(body.source || 'api'),
    });
    if (!result.ok) {
      return NextResponse.json(
        apiError(
          (result.code as 'CONFLICT') || 'VALIDATION',
          result.error,
          { blocking: result.blocking },
        ),
        { status: result.code === 'CONFLICT' ? 409 : 422 },
      );
    }
    return NextResponse.json({ ok: true, enrollmentId: result.enrollmentId });
  }

  if (resource === 'dialer') {
    const result = await recordDialerAttempt({
      attemptId: body.attempt_id ? String(body.attempt_id) : undefined,
      entityId: c.entityId,
      contactId: String(body.contact_id),
      ownerId: c.session.profile.id,
      enrollmentId: body.enrollment_id ? String(body.enrollment_id) : null,
      stepId: body.step_id ? String(body.step_id) : null,
      outcome: body.outcome as 'vm_dropped',
      vmDropped: Boolean(body.vm_dropped),
      pairedEmailTemplateId: body.paired_email_template_id
        ? String(body.paired_email_template_id)
        : null,
      plane: body.plane as 'graph' | undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  }

  if (resource === 'docusign') {
    const result = await queueSendEnvelope({
      entityId: c.entityId,
      libraryDocumentId: String(body.library_document_id || ''),
      contactIds: (body.contact_ids as string[]) || [],
      campaignId: body.campaign_id ? String(body.campaign_id) : null,
      enrollmentId: body.enrollment_id ? String(body.enrollment_id) : null,
    });
    if (!result.ok) {
      return NextResponse.json(apiError('VALIDATION', result.error), { status: 422 });
    }
    return NextResponse.json({ ok: true, actionIds: result.actionIds, envelopeIds: result.envelopeIds });
  }

  if (resource === 'settings') {
    if (body.action === 'kill_switch') {
      await setKillSwitch(c.entityId, Boolean(body.enabled));
      return NextResponse.json({ ok: true, kill_switch: Boolean(body.enabled) });
    }
  }

  if (resource === 'journeys') {
    const sb = await createPersistClient({ mode: 'service' });
    const { data, error } = await sb
      .from('ecc_journeys')
      .insert({
        entity_id: c.entityId,
        name: String(body.name || 'Sequence'),
        journey_type: String(body.journey_type || 'sequence'),
        status: 'draft',
        mutex_group: body.mutex_group ? String(body.mutex_group) : null,
        default_delivery_plane: String(body.default_delivery_plane || 'auto'),
        graph_json: body.graph_json ?? { nodes: [], edges: [] },
        created_by: c.session.profile.id,
        owner_id: c.session.profile.id,
      })
      .select('*')
      .single();
    if (error) {
      return NextResponse.json(apiError('VALIDATION', error.message), { status: 422 });
    }
    return NextResponse.json({ ok: true, journey: data }, { status: 201 });
  }

  return NextResponse.json(apiError('VALIDATION', 'Unknown resource'), { status: 422 });
}
