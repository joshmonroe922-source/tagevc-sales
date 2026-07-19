/**
 * Subsidiary → Tage ticket intake.
 *
 * Auth: `x-ticket-intake-secret` must match edge secret `TICKET_INTAKE_SECRET`.
 * Creates (or idempotently updates) a `portal_tickets` row for execution in Tage.
 *
 * See docs/TICKETING_MULTI_PORTAL.md for the full contract.
 */
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/supabase.ts';

const SOURCE_PORTALS = new Set([
  'tage',
  'recruit619-desk',
  'instant-nda',
  'signent',
  'other',
]);

const CATEGORIES = new Set([
  'technology',
  'legal',
  'accounting-finance',
  'marketing',
  'human-resources',
  'admin',
]);

const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

type IntakeBody = {
  source_portal?: string;
  external_id?: string;
  external_url?: string | null;
  entity_slug?: string | null;
  entity_id?: string | null;
  title?: string;
  description?: string;
  category?: string;
  priority?: string;
  requester_email?: string;
  diagnostic_context?: Record<string, unknown>;
};

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin);
  }

  try {
    const expected = Deno.env.get('TICKET_INTAKE_SECRET')?.trim();
    if (!expected) {
      return jsonResponse(
        { error: 'TICKET_INTAKE_SECRET not configured' },
        503,
        origin,
      );
    }

    const provided =
      req.headers.get('x-ticket-intake-secret')?.trim() ||
      req.headers.get('X-Ticket-Intake-Secret')?.trim();
    if (!provided || provided !== expected) {
      return jsonResponse({ error: 'Unauthorized' }, 401, origin);
    }

    const body = (await req.json()) as IntakeBody;
    const sourcePortal = (body.source_portal ?? '').trim();
    const externalId = (body.external_id ?? '').trim();
    const title = (body.title ?? '').trim();
    const category = (body.category ?? 'technology').trim();
    const priority = (body.priority ?? 'normal').trim();
    const requesterEmail = (body.requester_email ?? '').trim().toLowerCase();

    if (!SOURCE_PORTALS.has(sourcePortal) || sourcePortal === 'tage') {
      return jsonResponse(
        {
          error:
            'source_portal required (recruit619-desk | instant-nda | signent | other)',
        },
        400,
        origin,
      );
    }
    if (!externalId) {
      return jsonResponse({ error: 'external_id required' }, 400, origin);
    }
    if (!title) {
      return jsonResponse({ error: 'title required' }, 400, origin);
    }
    if (!CATEGORIES.has(category)) {
      return jsonResponse({ error: 'invalid category' }, 400, origin);
    }
    if (!PRIORITIES.has(priority)) {
      return jsonResponse({ error: 'invalid priority' }, 400, origin);
    }

    const service = createServiceClient();

    // Resolve created_by: requester email → sales_user, else house/system user
    let createdBy: string | null = null;
    if (requesterEmail) {
      const { data: su } = await service
        .from('sales_users')
        .select('id')
        .eq('email', requesterEmail)
        .eq('active', true)
        .maybeSingle();
      createdBy = su?.id ?? null;
    }
    if (!createdBy) {
      const systemEmail =
        Deno.env.get('TICKET_SYSTEM_USER_EMAIL')?.trim().toLowerCase() ||
        'portal@tagevc.com';
      const { data: sys } = await service
        .from('sales_users')
        .select('id')
        .eq('email', systemEmail)
        .eq('active', true)
        .maybeSingle();
      createdBy = sys?.id ?? null;
    }
    if (!createdBy) {
      // Last resort: any active admin
      const { data: admin } = await service
        .from('sales_users')
        .select('id')
        .eq('role', 'admin')
        .eq('active', true)
        .limit(1)
        .maybeSingle();
      createdBy = admin?.id ?? null;
    }
    if (!createdBy) {
      return jsonResponse(
        { error: 'No sales_users row to attribute ticket to' },
        500,
        origin,
      );
    }

    let entityId: string | null = body.entity_id?.trim() || null;
    if (!entityId && body.entity_slug?.trim()) {
      const { data: ent } = await service
        .from('ops_entities')
        .select('id')
        .eq('slug', body.entity_slug.trim())
        .maybeSingle();
      entityId = ent?.id ?? null;
    }

    // Idempotent upsert on (source_portal, external_id)
    const { data: existing } = await service
      .from('portal_tickets')
      .select('id, ticket_number, status')
      .eq('source_portal', sourcePortal)
      .eq('external_id', externalId)
      .maybeSingle();

    const diagnostic = {
      ...(body.diagnostic_context ?? {}),
      intake: {
        source_portal: sourcePortal,
        external_id: externalId,
        received_at: new Date().toISOString(),
      },
    };

    if (existing) {
      const { data: updated, error: upErr } = await service
        .from('portal_tickets')
        .update({
          title,
          description: (body.description ?? '').trim(),
          category,
          priority,
          entity_id: entityId,
          external_url: body.external_url ?? null,
          sync_status: 'synced',
          last_synced_at: new Date().toISOString(),
          sync_error: null,
          diagnostic_context: diagnostic,
        })
        .eq('id', existing.id)
        .select('id, ticket_number, status')
        .single();
      if (upErr) throw new Error(upErr.message);
      return jsonResponse(
        {
          ok: true,
          created: false,
          ticket_id: updated.id,
          ticket_number: updated.ticket_number,
          status: updated.status,
        },
        200,
        origin,
      );
    }

    const { data: created, error: insErr } = await service
      .from('portal_tickets')
      .insert({
        title,
        description: (body.description ?? '').trim(),
        category,
        priority,
        created_by: createdBy,
        diagnostic_context: diagnostic,
        source_portal: sourcePortal,
        entity_id: entityId,
        created_via: 'subsidiary_api',
        external_id: externalId,
        external_url: body.external_url ?? null,
        sync_status: 'synced',
        last_synced_at: new Date().toISOString(),
        assignee_has_unread: true,
        creator_has_unread: false,
      })
      .select('id, ticket_number, status')
      .single();

    if (insErr) throw new Error(insErr.message);

    return jsonResponse(
      {
        ok: true,
        created: true,
        ticket_id: created.id,
        ticket_number: created.ticket_number,
        status: created.status,
        portal_path: `/sales/tickets/${created.id}`,
      },
      201,
      origin,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Intake failed';
    return jsonResponse({ error: message }, 500, origin);
  }
});
