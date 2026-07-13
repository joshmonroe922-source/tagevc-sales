import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { sendResendEmail, tagsFromRecord } from '../_shared/email.ts';
import { recordOutboundEmail } from '../_shared/emailAnalytics.ts';
import { enrollLeadInNewDrip } from '../_shared/drips.ts';
import { createServiceClient } from '../_shared/supabase.ts';

type IntakeBody = {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  deal_path?: string;
  source?: string;
  notes?: string;
  enroll_drip?: boolean;
};

const VALID_PATHS = new Set(['launch', 'partner', 'exit']);
const VALID_SOURCES = new Set(['website_form', 'manual', 'referral']);

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin);
  }

  try {
    const body = (await req.json()) as IntakeBody;
    const name = (body.name ?? '').trim();
    const email = (body.email ?? '').trim().toLowerCase();
    const phone = (body.phone ?? '').trim();
    const company = (body.company ?? '').trim();
    const notes = (body.notes ?? '').trim();
    const dealPath = (body.deal_path ?? 'launch').trim().toLowerCase();
    const source = (body.source ?? 'website_form').trim().toLowerCase();
    const enrollDrip = body.enroll_drip !== false;

    if (!name) {
      return jsonResponse({ error: 'name is required' }, 400, origin);
    }
    if (!VALID_PATHS.has(dealPath)) {
      return jsonResponse(
        { error: 'deal_path must be launch, partner, or exit' },
        400,
        origin,
      );
    }
    if (!VALID_SOURCES.has(source)) {
      return jsonResponse(
        { error: 'source must be website_form, manual, or referral' },
        400,
        origin,
      );
    }

    const supabase = createServiceClient();
    const { data: assignedRepId } = await supabase.rpc('assign_lead_round_robin');

    const { data: lead, error } = await supabase
      .from('sales_leads')
      .insert({
        name,
        email,
        phone,
        company,
        deal_path: dealPath,
        source,
        notes,
        stage: 'new',
        assigned_rep_id: assignedRepId ?? null,
      })
      .select('id, name, email, company, deal_path, assigned_rep_id, stage')
      .single();

    if (error || !lead) {
      console.error('intake insert failed', error);
      return jsonResponse({ error: 'Failed to create lead' }, 500, origin);
    }

    await supabase.from('sales_lead_activities').insert({
      lead_id: lead.id,
      activity_type: 'intake',
      summary: `Website intake (${source})`,
      metadata: { deal_path: dealPath, company },
      created_by: assignedRepId ?? null,
    });

    if (enrollDrip) {
      await enrollLeadInNewDrip(supabase, lead);
    }

    const { data: settings } = await supabase
      .from('sales_settings')
      .select('intake_alert_email, auto_emails_enabled')
      .eq('id', '00000000-0000-4000-8000-000000000001')
      .maybeSingle();

    const alertTo =
      settings?.intake_alert_email ||
      Deno.env.get('INTAKE_ALERT_EMAIL') ||
      'hello@tagevc.com';

    if (settings?.auto_emails_enabled !== false && alertTo) {
      const portalUrl =
        Deno.env.get('SALES_PORTAL_URL') || 'http://localhost:5173';
      const pathLabel =
        dealPath === 'launch'
          ? 'Launch'
          : dealPath === 'partner'
            ? 'Partner'
            : 'Exit';
      const alertSubject = `[Tage VC] New lead: ${name}${company ? ` — ${company}` : ''}`;
      const tags = tagsFromRecord({
        source: 'intake_alert',
        lead_id: lead.id,
      });
      const sent = await sendResendEmail({
        to: alertTo,
        subject: alertSubject,
        html: `
          <p>New inbound lead for <strong>${pathLabel}</strong>.</p>
          <ul>
            <li><strong>Name:</strong> ${name}</li>
            <li><strong>Email:</strong> ${email || '—'}</li>
            <li><strong>Phone:</strong> ${phone || '—'}</li>
            <li><strong>Company:</strong> ${company || '—'}</li>
            <li><strong>Source:</strong> ${source}</li>
          </ul>
          ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ''}
          <p><a href="${portalUrl}/sales/deal-sourcing/leads/${lead.id}">Open in Deal Sourcing</a></p>
        `,
        replyTo: email || undefined,
        tags,
      });
      if (sent.ok && sent.id) {
        await recordOutboundEmail(supabase, {
          resendId: sent.id,
          to: alertTo,
          subject: alertSubject,
          source: 'intake_alert',
          leadId: lead.id,
          replyTo: email || null,
          tags,
        });
      }
    }

    return jsonResponse({ ok: true, lead_id: lead.id }, 201, origin);
  } catch (err) {
    console.error(err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Unexpected error' },
      500,
      origin,
    );
  }
});
