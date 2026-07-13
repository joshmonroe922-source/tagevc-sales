import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { sendResendEmail, tagsFromRecord } from '../_shared/email.ts';
import { recordOutboundEmail } from '../_shared/emailAnalytics.ts';
import { createServiceClient, createUserClient } from '../_shared/supabase.ts';

type Body = {
  lead_id?: string;
  to?: string;
  subject?: string;
  html?: string;
  reply_to?: string;
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
    const leadId = (body.lead_id ?? '').trim();
    const subject = (body.subject ?? '').trim();
    const html = (body.html ?? '').trim();
    let to = (body.to ?? '').trim().toLowerCase();
    const replyTo = (body.reply_to ?? '').trim() || undefined;

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

    const tags = tagsFromRecord({
      source: 'portal_tracked',
      lead_id: lead.id,
    });

    const sent = await sendResendEmail({
      to,
      subject,
      html,
      replyTo,
      tags,
    });

    if (!sent.ok || !sent.id) {
      return jsonResponse(
        { error: sent.error ?? 'Failed to send email' },
        502,
        origin,
      );
    }

    await recordOutboundEmail(service, {
      resendId: sent.id,
      to,
      subject,
      source: 'portal_tracked',
      leadId: lead.id,
      replyTo: replyTo ?? null,
      tags,
      sentBy: salesUser.id,
    });

    await service.from('sales_lead_activities').insert({
      lead_id: lead.id,
      activity_type: 'email_sent',
      summary: `Tracked email: ${subject}`,
      metadata: {
        resend_id: sent.id,
        to,
        source: 'portal_tracked',
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
        source: 'portal_tracked',
        lead_id: lead.id,
        resend_id: sent.id,
      },
    });

    return jsonResponse(
      {
        ok: true,
        resend_id: sent.id,
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
