import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { sendResendEmail } from '../_shared/email.ts';
import { createServiceClient, createUserClient } from '../_shared/supabase.ts';

type Body = {
  ticketId?: string;
  event?: 'created' | 'assigned' | 'comment';
};

const CATEGORY_LABELS: Record<string, string> = {
  technology: 'Technology',
  legal: 'Legal',
  'accounting-finance': 'Finance / Accounting',
  marketing: 'Marketing',
  'human-resources': 'Human Resources',
  admin: 'General / Admin',
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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Unauthorized' }, 401, origin);
    }

    const userClient = createUserClient(authHeader);
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user?.email) {
      return jsonResponse({ error: 'Unauthorized' }, 401, origin);
    }

    const service = createServiceClient();
    const { data: salesUser } = await service
      .from('sales_users')
      .select('id, role, active, email')
      .eq('email', user.email.toLowerCase())
      .eq('active', true)
      .maybeSingle();

    if (!salesUser) {
      return jsonResponse({ error: 'Forbidden' }, 403, origin);
    }

    const body = (await req.json()) as Body;
    const ticketId = body.ticketId?.trim();
    const event = body.event ?? 'created';
    if (!ticketId) {
      return jsonResponse({ error: 'ticketId required' }, 400, origin);
    }

    const { data: ticket, error: tErr } = await service
      .from('portal_tickets')
      .select(
        `
        id, ticket_number, title, category, status, priority, created_by, assignee_id,
        creator:sales_users!portal_tickets_created_by_fkey ( email, full_name ),
        assignee:sales_users!portal_tickets_assignee_id_fkey ( email, full_name )
      `,
      )
      .eq('id', ticketId)
      .maybeSingle();

    if (tErr || !ticket) {
      return jsonResponse({ error: tErr?.message ?? 'Ticket not found' }, 404, origin);
    }

    const site =
      Deno.env.get('PUBLIC_APP_URL')?.replace(/\/$/, '') ||
      Deno.env.get('SITE_URL')?.replace(/\/$/, '') ||
      'https://portal.tagevc.com';
    const link = `${site}/sales/tickets/${ticket.id}`;
    const cat = CATEGORY_LABELS[ticket.category as string] ?? ticket.category;
    const ref = `#${ticket.ticket_number}`;

    const recipients = new Set<string>();

    // Always notify assignee when set (except the acting user)
    const assignee = ticket.assignee as { email?: string } | null;
    if (assignee?.email && assignee.email.toLowerCase() !== user.email.toLowerCase()) {
      recipients.add(assignee.email.toLowerCase());
    }

    // On create: notify admins + users with the matching portal assignment
    if (event === 'created' || event === 'comment') {
      const { data: admins } = await service
        .from('sales_users')
        .select('email')
        .eq('role', 'admin')
        .eq('active', true);
      for (const a of admins ?? []) {
        if (a.email) recipients.add(String(a.email).toLowerCase());
      }

      const portalSlug =
        ticket.category === 'admin'
          ? null
          : ticket.category === 'accounting-finance'
            ? 'accounting-finance'
            : ticket.category === 'human-resources'
              ? 'human-resources'
              : String(ticket.category);

      if (portalSlug) {
        const { data: portal } = await service
          .from('sales_portals')
          .select('id')
          .eq('slug', portalSlug)
          .maybeSingle();
        if (portal?.id) {
          const { data: assigned } = await service
            .from('sales_user_portals')
            .select('sales_user_id, sales_users ( email, active )')
            .eq('portal_id', portal.id);
          for (const row of assigned ?? []) {
            const su = row.sales_users as { email?: string; active?: boolean } | null;
            if (su?.active && su.email) recipients.add(su.email.toLowerCase());
          }
        }
      }

      // Creator gets comment emails
      if (event === 'comment') {
        const creator = ticket.creator as { email?: string } | null;
        if (creator?.email) recipients.add(creator.email.toLowerCase());
      }
    }

    // Don't email the person who triggered the event
    recipients.delete(user.email.toLowerCase());

    if (recipients.size === 0) {
      return jsonResponse({ ok: true, emailed: 0 }, 200, origin);
    }

    const subject =
      event === 'created'
        ? `[Ticket ${ref}] New ${cat}: ${ticket.title}`
        : event === 'assigned'
          ? `[Ticket ${ref}] Assigned to you: ${ticket.title}`
          : `[Ticket ${ref}] Update: ${ticket.title}`;

    const html = `
      <p><strong>${ref}</strong> — ${escapeHtml(String(ticket.title))}</p>
      <p>Queue: ${escapeHtml(cat)} · Status: ${escapeHtml(String(ticket.status))} · Priority: ${escapeHtml(String(ticket.priority))}</p>
      <p><a href="${link}">Open ticket in portal</a></p>
      <p style="color:#666;font-size:12px">Soft alert from Tage VC portal ticketing. Unread badges also appear in the app.</p>
    `;

    let emailed = 0;
    for (const to of recipients) {
      const sent = await sendResendEmail({
        to,
        subject,
        html,
        tags: {
          kind: 'portal_ticket',
          event,
          ticket_id: ticket.id,
        },
      });
      if (sent.ok) emailed += 1;
    }

    return jsonResponse({ ok: true, emailed }, 200, origin);
  } catch (err) {
    console.error('portal-ticket-notify', err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Server error' },
      500,
      origin,
    );
  }
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
