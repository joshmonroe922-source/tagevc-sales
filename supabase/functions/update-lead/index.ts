import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { cancelActiveDrips, enrollLeadInNewDrip } from '../_shared/drips.ts';
import { createServiceClient, createUserClient } from '../_shared/supabase.ts';

const VALID_STAGES = new Set([
  'new',
  'qualified',
  'call_booked',
  'diligence',
  'term_sheet',
  'closed_won',
  'closed_lost',
  'passed',
]);

const VALID_PATHS = new Set(['launch', 'partner', 'exit']);
const VALID_SOURCES = new Set(['website_form', 'manual', 'referral']);
const TERMINAL = new Set(['closed_won', 'closed_lost', 'passed']);

type UpdateBody = {
  lead_id?: string;
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  deal_path?: string;
  source?: string;
  notes?: string;
  stage?: string;
  next_action_at?: string | null;
  assigned_rep_id?: string | null;
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
      .select('id, role, active')
      .eq('email', user.email.toLowerCase())
      .eq('active', true)
      .maybeSingle();

    if (!salesUser) {
      return jsonResponse({ error: 'Forbidden' }, 403, origin);
    }

    const body = (await req.json()) as UpdateBody;
    if (!body.lead_id) {
      return jsonResponse({ error: 'lead_id is required' }, 400, origin);
    }

    const { data: existing, error: fetchErr } = await service
      .from('sales_leads')
      .select('*')
      .eq('id', body.lead_id)
      .maybeSingle();

    if (fetchErr || !existing) {
      return jsonResponse({ error: 'Lead not found' }, 404, origin);
    }

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.email !== undefined) patch.email = body.email.trim().toLowerCase();
    if (body.phone !== undefined) patch.phone = body.phone.trim();
    if (body.company !== undefined) patch.company = body.company.trim();
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.next_action_at !== undefined) patch.next_action_at = body.next_action_at;
    if (body.assigned_rep_id !== undefined) {
      patch.assigned_rep_id = body.assigned_rep_id;
    }
    if (body.deal_path !== undefined) {
      if (!VALID_PATHS.has(body.deal_path)) {
        return jsonResponse({ error: 'Invalid deal_path' }, 400, origin);
      }
      patch.deal_path = body.deal_path;
    }
    if (body.source !== undefined) {
      if (!VALID_SOURCES.has(body.source)) {
        return jsonResponse({ error: 'Invalid source' }, 400, origin);
      }
      patch.source = body.source;
    }
    if (body.stage !== undefined) {
      if (!VALID_STAGES.has(body.stage)) {
        return jsonResponse({ error: 'Invalid stage' }, 400, origin);
      }
      patch.stage = body.stage;
    }

    const { data: updated, error: updateErr } = await service
      .from('sales_leads')
      .update(patch)
      .eq('id', body.lead_id)
      .select('*')
      .single();

    if (updateErr || !updated) {
      return jsonResponse({ error: updateErr?.message ?? 'Update failed' }, 500, origin);
    }

    if (body.stage && body.stage !== existing.stage) {
      await service.from('sales_lead_activities').insert({
        lead_id: updated.id,
        activity_type: 'stage_change',
        summary: `Stage: ${existing.stage} → ${body.stage}`,
        metadata: { from: existing.stage, to: body.stage },
        created_by: salesUser.id,
      });

      if (TERMINAL.has(body.stage)) {
        await cancelActiveDrips(service, updated.id);
        await service
          .from('sales_tasks')
          .update({ status: 'done', completed_at: new Date().toISOString() })
          .eq('lead_id', updated.id)
          .eq('status', 'open');
      } else if (body.stage === 'new' && existing.stage !== 'new') {
        await enrollLeadInNewDrip(service, updated);
      }
    }

    return jsonResponse({ ok: true, lead: updated }, 200, origin);
  } catch (err) {
    console.error(err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Unexpected error' },
      500,
      origin,
    );
  }
});
