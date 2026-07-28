import { NextResponse } from 'next/server';
import { createTicket, getTicket, listTickets } from '@/lib/data/ticket-store';
import { authorizeSubsidiaryTicketRequest } from '@/lib/multi-sub/subsidiary-ticket-auth';
import {
  filterTicketsByEntityAndService,
  requireTicketEntityId,
  validateContextLinksForEntity,
  type TicketContextLink,
  MS_P2_CONTRACT_VERSION,
} from '@/lib/multi-sub/ticketing';
import { captureException } from '@/lib/observability';
import { SS_SERVICES, TICKET_PRIORITIES } from '@/lib/types';
import type { SsService, TicketPriority } from '@/lib/types';

/**
 * Subsidiary portal ticket API (P2).
 * POST create | GET status / list
 *
 * Auth: signed subsidiary token OR x-tagevc-subsidiary-client + secret
 * (SUBSIDIARY_API_SECRET / CRON_SECRET). Least privilege per client entity.
 */
export async function POST(request: Request) {
  const auth = await authorizeSubsidiaryTicketRequest(request, 'tickets:write');
  if (!auth.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: auth.error,
        money_auto_approve: false,
        contract_version: MS_P2_CONTRACT_VERSION,
      },
      { status: auth.status },
    );
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const entityGate = requireTicketEntityId(
      (body.entity_id as string) || auth.client.entity_id,
    );
    if (!entityGate.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: entityGate.error,
          money_auto_approve: false,
          contract_version: MS_P2_CONTRACT_VERSION,
        },
        { status: 400 },
      );
    }
    if (entityGate.entity_id !== auth.client.entity_id) {
      return NextResponse.json(
        {
          ok: false,
          error: `Client ${auth.client.client_id} may only create tickets for ${auth.client.entity_id}`,
          money_auto_approve: false,
          contract_version: MS_P2_CONTRACT_VERSION,
        },
        { status: 403 },
      );
    }

    const service = String(body.service ?? 'IT') as SsService;
    const priority = String(body.priority ?? 'P2') as TicketPriority;
    if (!SS_SERVICES.includes(service)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid service' },
        { status: 400 },
      );
    }
    if (!TICKET_PRIORITIES.includes(priority)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid priority' },
        { status: 400 },
      );
    }

    const contextLinks = Array.isArray(body.context_links)
      ? (body.context_links as TicketContextLink[])
      : [];
    if (contextLinks.length > 0) {
      const linkGate = validateContextLinksForEntity(
        entityGate.entity_id,
        contextLinks,
      );
      if (!linkGate.ok) {
        return NextResponse.json(
          { ok: false, error: linkGate.error },
          { status: 400 },
        );
      }
    }

    const title = String(body.title ?? '').trim();
    if (title.length < 3) {
      return NextResponse.json(
        { ok: false, error: 'title required (min 3)' },
        { status: 400 },
      );
    }

    const sourceSystem =
      entityGate.entity_id === 'ENT-R619'
        ? 'recruit619'
        : entityGate.entity_id === 'ENT-INDA'
          ? 'instantnda'
          : 'system';

    const ticket = createTicket({
      title,
      description: body.description ? String(body.description) : undefined,
      desired_outcome: body.desired_outcome
        ? String(body.desired_outcome)
        : undefined,
      service,
      priority,
      requester_name: body.requester_name
        ? String(body.requester_name)
        : auth.client.client_id,
      entity_id: entityGate.entity_id,
      company_name: body.company_name ? String(body.company_name) : undefined,
      links: body.links ? String(body.links) : undefined,
      sla_due_at: body.sla_due_at ? String(body.sla_due_at) : undefined,
      source_system: sourceSystem,
      source_ref: body.source_ref ? String(body.source_ref) : 'help_desk',
    });

    return NextResponse.json({
      ok: true,
      money_auto_approve: false as const,
      contract_version: MS_P2_CONTRACT_VERSION,
      ticket: {
        ticket_id: ticket.ticket_id,
        status: ticket.status,
        entity_id: ticket.entity_id,
        autonomy_band: ticket.autonomy_band,
        confidence: ticket.confidence,
        forbid_hits: ticket.forbid_hits,
        draft_approval: ticket.draft_approval,
      },
      diagnose_preserved: true,
      source: auth.source,
    });
  } catch (e) {
    captureException(e, { route: 'subsidiary/tickets POST' });
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'create failed',
        money_auto_approve: false,
        contract_version: MS_P2_CONTRACT_VERSION,
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  const auth = await authorizeSubsidiaryTicketRequest(request, 'tickets:read');
  if (!auth.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: auth.error,
        money_auto_approve: false,
        contract_version: MS_P2_CONTRACT_VERSION,
      },
      { status: auth.status },
    );
  }

  try {
    const url = new URL(request.url);
    const ticketId = url.searchParams.get('ticket_id')?.trim();
    const service = url.searchParams.get('service')?.trim() || null;
    const mine = url.searchParams.get('mine') === '1';
    const requester = url.searchParams.get('requester')?.trim();

    if (ticketId) {
      const ticket = getTicket(ticketId);
      if (!ticket || ticket.entity_id !== auth.client.entity_id) {
        return NextResponse.json(
          {
            ok: false,
            found: false,
            error: 'Not found',
            money_auto_approve: false,
            contract_version: MS_P2_CONTRACT_VERSION,
          },
          { status: 404 },
        );
      }
      return NextResponse.json({
        ok: true,
        found: true,
        money_auto_approve: false as const,
        contract_version: MS_P2_CONTRACT_VERSION,
        ticket: {
          ticket_id: ticket.ticket_id,
          status: ticket.status,
          service: ticket.service,
          priority: ticket.priority,
          entity_id: ticket.entity_id,
          autonomy_band: ticket.autonomy_band,
          draft_approval: ticket.draft_approval,
          updated_at: ticket.updated_at,
        },
      });
    }

    let rows = filterTicketsByEntityAndService(listTickets(), {
      entityId: auth.client.entity_id,
      service,
    });
    if (mine || requester) {
      const who = requester || auth.client.client_id;
      rows = rows.filter((t) => t.requester_name === who);
    }

    return NextResponse.json({
      ok: true,
      money_auto_approve: false as const,
      contract_version: MS_P2_CONTRACT_VERSION,
      entity_id: auth.client.entity_id,
      tickets: rows.slice(0, 100).map((t) => ({
        ticket_id: t.ticket_id,
        title: t.title,
        status: t.status,
        service: t.service,
        priority: t.priority,
        entity_id: t.entity_id,
        autonomy_band: t.autonomy_band,
        created_at: t.created_at,
        updated_at: t.updated_at,
      })),
    });
  } catch (e) {
    captureException(e, { route: 'subsidiary/tickets GET' });
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'list failed',
        money_auto_approve: false,
        contract_version: MS_P2_CONTRACT_VERSION,
      },
      { status: 500 },
    );
  }
}
