import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { recordOutboundEmail } from '../_shared/emailAnalytics.ts';
import { injectMailTracking } from '../_shared/mailTracking.ts';
import {
  getMsConfig,
  getValidAccessToken,
  preferredWorkEmail,
  requireActiveSalesUser,
  scopesInclude,
  sendMailMessage,
} from '../_shared/microsoftGraph.ts';
import { createServiceClient, createUserClient } from '../_shared/supabase.ts';

type Body = {
  lead_id?: string;
  to?: string;
  subject?: string;
  html?: string;
};

function trackingToken(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

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
    const salesUser = await requireActiveSalesUser(service, user.email);
    if (!salesUser) {
      return jsonResponse({ error: 'Forbidden' }, 403, origin);
    }

    const config = getMsConfig();
    if (!config.configured) {
      return jsonResponse(
        {
          error:
            'Microsoft mail is not configured. Connect Outlook in Calendar settings first.',
          needs_reconnect: true,
        },
        503,
        origin,
      );
    }

    let accessToken: string;
    let microsoftEmail: string | null = null;
    let connectionScopes: string | null = null;
    try {
      const result = await getValidAccessToken(service, config, salesUser.id);
      accessToken = result.accessToken;
      microsoftEmail = result.connection.microsoft_email;
      connectionScopes = result.connection.scopes;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Not connected';
      return jsonResponse(
        {
          error: `${message}. Connect Microsoft mail in Settings → Reconnect.`,
          needs_reconnect: true,
        },
        401,
        origin,
      );
    }

    if (
      !scopesInclude(connectionScopes, 'Mail.Send') ||
      !scopesInclude(connectionScopes, 'Mail.ReadWrite')
    ) {
      return jsonResponse(
        {
          error:
            'Mail.Send and Mail.ReadWrite are required. Reconnect Microsoft after admin consent.',
          needs_reconnect: true,
        },
        403,
        origin,
      );
    }

    const body = (await req.json()) as Body;
    const leadId = (body.lead_id ?? '').trim();
    const subject = (body.subject ?? '').trim();
    const html = (body.html ?? '').trim();
    let to = (body.to ?? '').trim().toLowerCase();

    if (!leadId) {
      return jsonResponse({ error: 'lead_id is required' }, 400, origin);
    }
    if (!subject) {
      return jsonResponse({ error: 'subject is required' }, 400, origin);
    }
    if (!html) {
      return jsonResponse({ error: 'html is required' }, 400, origin);
    }

    const { data: lead, error: leadErr } = await service
      .from('sales_leads')
      .select('id, name, email, company')
      .eq('id', leadId)
      .maybeSingle();

    if (leadErr || !lead) {
      return jsonResponse({ error: 'Lead not found' }, 404, origin);
    }

    if (!to) {
      to = (lead.email ?? '').trim().toLowerCase();
    }
    if (!to) {
      return jsonResponse(
        { error: 'Recipient email is required (lead has no email)' },
        400,
        origin,
      );
    }

    const token = trackingToken();
    const trackedHtml = injectMailTracking(html, token);
    const fromAddress =
      (microsoftEmail ?? preferredWorkEmail(salesUser)).trim().toLowerCase();

    await sendMailMessage(accessToken, {
      subject,
      bodyHtml: trackedHtml,
      to: [to],
      saveToSentItems: true,
    });

    const messageId = await recordOutboundEmail(service, {
      trackingToken: token,
      provider: 'graph',
      to,
      subject,
      source: 'portal_tracked',
      leadId: lead.id,
      fromAddress,
      sentBy: salesUser.id,
    });

    await service.from('sales_lead_activities').insert({
      lead_id: lead.id,
      activity_type: 'email_sent',
      summary: `Tracked email: ${subject}`,
      metadata: {
        tracking_token: token,
        to,
        from: fromAddress,
        source: 'portal_tracked',
        provider: 'graph',
      },
      created_by: salesUser.id,
    });

    await service.rpc('insert_audit_event', {
      p_user_id: salesUser.id,
      p_email: salesUser.email,
      p_event_type: 'email_sent',
      p_path: `/sales/deal-sourcing/leads/${lead.id}`,
      p_metadata: {
        to,
        subject,
        from: fromAddress,
        source: 'portal_tracked',
        lead_id: lead.id,
        tracking_token: token,
        provider: 'graph',
      },
    });

    return jsonResponse(
      {
        ok: true,
        message_id: messageId,
        tracking_token: token,
        from: fromAddress,
        to,
        subject,
      },
      200,
      origin,
    );
  } catch (err) {
    console.error(err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Unexpected error' },
      500,
      origin,
    );
  }
});
