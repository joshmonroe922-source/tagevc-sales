import { NextResponse } from 'next/server';

import {
  fetchAllTickets,
  syncTickets,
} from '@/lib/data/normalized/tickets-repo';
import {
  createTicket,
  getTicket,
  hydrateTicketStore,
} from '@/lib/data/ticket-store';
import { resolveCanonicalEntityId } from '@/lib/multi-sub/entity-registry';
import { createPersistClient } from '@/lib/supabase/persist-client';
import type { SsService } from '@/lib/types';

/**
 * Subsidiary portal → Tage Shared Services intake (Recruit 619, Instant NDA, …).
 * Auth: Authorization Bearer === TAGE_SS_WEBHOOK_SECRET (or RECRUIT_SS_INTAKE_SECRET)
 */
function authorize(request: Request): boolean {
  const secret =
    process.env.TAGE_SS_WEBHOOK_SECRET?.trim() ||
    process.env.RECRUIT_SS_INTAKE_SECRET?.trim();
  if (!secret) {
    return process.env.NODE_ENV !== 'production';
  }
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  return token === secret;
}

function mapKind(kind: string): SsService {
  const k = kind.toLowerCase();
  if (k === 'finance') return 'Finance';
  if (k === 'legal') return 'Legal';
  if (k === 'hr') return 'HR';
  if (k === 'it') return 'IT';
  if (k === 'marketing') return 'Marketing';
  return 'IT';
}

function intakeBrand(entityId: string) {
  const canon = resolveCanonicalEntityId(entityId) || entityId;
  if (canon === 'ENT-INDA') {
    return {
      prefix: '[INDA]',
      company: 'Instant NDA',
      requester: 'Instant NDA Portal',
      portalBase:
        process.env.INSTANTNDA_PORTAL_URL?.trim() ||
        'https://portal.instantnda.us',
      outcome: 'Resolve Shared Services request for Instant NDA',
      ticketLabel: 'Instant NDA ticket',
    };
  }
  return {
    prefix: '[R619]',
    company: 'Recruit 619',
    requester: 'Recruit 619 Portal',
    portalBase:
      process.env.RECRUIT_PORTAL_URL?.trim() || 'https://portal.recruit619.com',
    outcome: 'Resolve Shared Services request for Recruit 619',
    ticketLabel: 'Recruit ticket',
  };
}

export async function POST(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    ticketId?: string;
    entityId?: string;
    kind?: string;
    subject?: string;
    resourceType?: string | null;
    resourceId?: string | null;
    portalUrl?: string | null;
    body?: string | null;
    pagePath?: string | null;
    priority?: string | null;
    screenshotDataUrl?: string | null;
    documentDataUrl?: string | null;
    documentName?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.ticketId || !body.subject || !body.kind) {
    return NextResponse.json(
      { error: 'ticketId, kind, subject required' },
      { status: 400 },
    );
  }

  const entityIdRaw = body.entityId?.trim() || 'ENT-R619';
  const entityId = resolveCanonicalEntityId(entityIdRaw) || entityIdRaw;
  const brand = intakeBrand(entityId);
  const portalBase = brand.portalBase;
  let portalUrl = body.portalUrl || portalBase;
  if (!body.portalUrl && body.resourceType && body.resourceId) {
    const rt = body.resourceType;
    if (rt === 'person') portalUrl = `${portalBase}/people/${body.resourceId}`;
    else if (rt === 'candidate')
      portalUrl = `${portalBase}/candidates/${body.resourceId}`;
    else if (rt === 'account')
      portalUrl = `${portalBase}/accounts/${body.resourceId}`;
    else if (rt === 'job') portalUrl = `${portalBase}/jobs/${body.resourceId}`;
    else if (rt === 'inda_customer')
      portalUrl = `${portalBase}/customers/${body.resourceId}`;
    else if (rt === 'inda_lead')
      portalUrl = `${portalBase}/sales`;
    else portalUrl = `${portalBase}/${rt}/${body.resourceId}`;
  }

  const linkParts: string[] = [
    `${brand.ticketLabel} ${body.ticketId}`,
    body.resourceType && body.resourceId
      ? `Context: ${body.resourceType}/${body.resourceId}`
      : null,
    body.pagePath ? `Page: ${body.pagePath}` : null,
    `Portal: ${portalUrl}`,
  ].filter(Boolean) as string[];

  const stableUploadFolder = body.ticketId.trim().replace(/[^\w.-]+/g, '_');

  // Fail-soft upload of screenshot / document from subsidiary Help Desk modal
  async function uploadDataUrl(
    dataUrl: string,
    filename: string,
  ): Promise<string | null> {
    try {
      const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
      if (!match) return null;
      const bytes = Buffer.from(match[2], 'base64');
      if (bytes.length > 5_000_000) return null;
      const admin = await createPersistClient();
      const path = `help-desk/intake/${stableUploadFolder}/${filename}`;
      const { error } = await admin.storage
        .from('os-uploads')
        .upload(path, bytes, { contentType: match[1], upsert: true });
      if (error) return null;
      const { data } = admin.storage.from('os-uploads').getPublicUrl(path);
      return data.publicUrl || path;
    } catch {
      return null;
    }
  }
  if (body.screenshotDataUrl?.startsWith('data:')) {
    const url = await uploadDataUrl(
      body.screenshotDataUrl,
      `screenshot-${Date.now()}.jpg`,
    );
    linkParts.push(url ? `screenshot:${url}` : 'screenshot:storage-unavailable');
  }
  if (body.documentDataUrl?.startsWith('data:')) {
    const safeName = (body.documentName || 'document')
      .replace(/[^\w.-]+/g, '_')
      .slice(0, 80);
    const url = await uploadDataUrl(
      body.documentDataUrl,
      `doc-${Date.now()}-${safeName}`,
    );
    linkParts.push(
      url
        ? `document:${url}`
        : `document:${body.documentName || 'attached'} (storage unavailable)`,
    );
  }

  const links = linkParts.join('\n');

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return NextResponse.json(
      { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY required' },
      { status: 503 },
    );
  }

  // Hydrate before allocate — cold serverless isolates otherwise mint colliding TK-### ids.
  await hydrateTicketStore({ forceSql: true });

  // Use portal ticket id as Tage ticket_id so upserts cannot overwrite unrelated TK rows.
  const stableTicketId = body.ticketId.trim();
  const existing = getTicket(stableTicketId);
  if (existing) {
    return NextResponse.json({
      ok: true,
      tageTicketId: existing.ticket_id,
      entityId: existing.entity_id ?? entityId,
      deduped: true,
    });
  }

  const sqlTickets = await fetchAllTickets();
  if (sqlTickets?.some((t) => t.ticket_id === stableTicketId)) {
    return NextResponse.json({
      ok: true,
      tageTicketId: stableTicketId,
      entityId,
      deduped: true,
    });
  }

  const priorityRaw = (body.priority ?? 'P2').toUpperCase();
  const priority = (
    ['P0', 'P1', 'P2', 'P3'].includes(priorityRaw)
      ? priorityRaw
      : priorityRaw === 'P4'
        ? 'P3'
        : 'P2'
  ) as 'P0' | 'P1' | 'P2' | 'P3';

  let ticket;
  try {
    ticket = createTicket({
      ticket_id: stableTicketId,
      title: `${brand.prefix} ${body.subject}`,
      description: [
        body.body?.trim() || `${brand.company} portal ticket`,
        '',
        links,
      ].join('\n'),
      desired_outcome: brand.outcome,
      service: mapKind(body.kind),
      priority,
      requester_name: brand.requester,
      entity_id: entityId,
      company_name: brand.company,
      links,
      source_ref: 'help_desk',
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Failed to create ticket',
      },
      { status: 409 },
    );
  }

  // Await durable writes — fire-and-forget sync is dropped on Vercel serverless.
  const synced = await syncTickets([ticket]);
  if (!synced) {
    return NextResponse.json(
      { error: 'Failed to persist ticket to os_tickets' },
      { status: 502 },
    );
  }

  try {
    const admin = await createPersistClient();
    const leanPayload = {
      ...body,
      screenshotDataUrl: body.screenshotDataUrl
        ? '[omitted]'
        : null,
      documentDataUrl: body.documentDataUrl ? '[omitted]' : null,
    };
    const { error } = await admin.from('os_recruit_inbound_tickets').upsert(
      {
        entity_id: entityId,
        recruit_ticket_id: body.ticketId,
        tage_ticket_id: ticket.ticket_id,
        kind: body.kind,
        subject: body.subject,
        resource_type: body.resourceType ?? null,
        resource_id: body.resourceId ?? null,
        portal_url: portalUrl,
        payload: leanPayload,
        status: 'opened',
      },
      { onConflict: 'entity_id,recruit_ticket_id' },
    );
    if (error) {
      console.error('[recruit-ss-intake] inbound upsert failed', error.message);
      return NextResponse.json(
        {
          ok: true,
          tageTicketId: ticket.ticket_id,
          entityId,
          warning: 'ticket persisted; inbound ledger upsert failed',
        },
        { status: 200 },
      );
    }
  } catch (err) {
    console.error('[recruit-ss-intake] inbound persist failed', err);
    return NextResponse.json(
      {
        ok: true,
        tageTicketId: ticket.ticket_id,
        entityId,
        warning: 'ticket persisted; inbound ledger upsert failed',
      },
      { status: 200 },
    );
  }

  return NextResponse.json({
    ok: true,
    tageTicketId: ticket.ticket_id,
    entityId,
  });
}
