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
import { createPersistClient } from '@/lib/supabase/persist-client';
import type { SsService } from '@/lib/types';

/**
 * Recruit portal → Tage Shared Services intake.
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

  const entityId = body.entityId?.trim() || 'ENT-R619';
  const portalBase =
    process.env.RECRUIT_PORTAL_URL?.trim() || 'https://portal.recruit619.com';
  let portalUrl = body.portalUrl || portalBase;
  if (!body.portalUrl && body.resourceType && body.resourceId) {
    const rt = body.resourceType;
    if (rt === 'person') portalUrl = `${portalBase}/people/${body.resourceId}`;
    else if (rt === 'candidate')
      portalUrl = `${portalBase}/candidates/${body.resourceId}`;
    else if (rt === 'account')
      portalUrl = `${portalBase}/accounts/${body.resourceId}`;
    else if (rt === 'job') portalUrl = `${portalBase}/jobs/${body.resourceId}`;
    else portalUrl = `${portalBase}/${rt}/${body.resourceId}`;
  }

  const links = [
    `Recruit ticket ${body.ticketId}`,
    body.resourceType && body.resourceId
      ? `Context: ${body.resourceType}/${body.resourceId}`
      : null,
    `Portal: ${portalUrl}`,
  ]
    .filter(Boolean)
    .join('\n');

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return NextResponse.json(
      { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY required' },
      { status: 503 },
    );
  }

  // Hydrate before allocate — cold serverless isolates otherwise mint colliding TK-### ids.
  await hydrateTicketStore();

  // Use Recruit ticket id as Tage ticket_id so upserts cannot overwrite unrelated TK rows.
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

  let ticket;
  try {
    ticket = createTicket({
      ticket_id: stableTicketId,
      title: `[R619] ${body.subject}`,
      description: [
        body.body?.trim() || 'Recruit portal ticket',
        '',
        links,
      ].join('\n'),
      desired_outcome: 'Resolve Shared Services request for Recruit 619',
      service: mapKind(body.kind),
      priority: 'P2',
      requester_name: 'Recruit 619 Portal',
      entity_id: entityId,
      company_name: 'Recruit 619',
      links,
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
        payload: body,
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
