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
  contact_id?: string | null;
  account_id?: string | null;
  deal_path?: string;
  source?: string;
  notes?: string;
  stage?: string;
  next_action_at?: string | null;
  assigned_rep_id?: string | null;
};

/** Map deal path → ops entity_type for new portfolio companies. */
function entityTypeForDealPath(dealPath: string | null | undefined): string {
  if (dealPath === 'launch') return 'launch';
  if (dealPath === 'exit') return 'acquire';
  return 'operate';
}

/**
 * When a deal closes won, ensure a portfolio entity exists with full shell
 * (Leadership / Think Tank / Financial / KPIs / Platform via UI routes;
 * HR/Tech/Accounting/Legal/Marketing via existing insert triggers).
 */
// deno-lint-ignore no-explicit-any
async function ensurePortfolioEntityForClosedDeal(
  service: any,
  lead: {
    id: string;
    name?: string | null;
    company?: string | null;
    deal_path?: string | null;
  },
  createdBy: string,
): Promise<{ id: string } | null> {
  const { data: linked } = await service
    .from('ops_entities')
    .select('id')
    .eq('lead_id', lead.id)
    .limit(1)
    .maybeSingle();
  if (linked?.id) return { id: linked.id as string };

  const companyName = String(lead.company ?? '').trim();
  const entityName =
    companyName ||
    `${String(lead.name ?? 'New company').trim()} (portfolio)`;

  if (companyName) {
    const { data: byName } = await service
      .from('ops_entities')
      .select('id, lead_id')
      .ilike('name', companyName)
      .limit(1)
      .maybeSingle();
    if (byName?.id) {
      if (!byName.lead_id) {
        await service
          .from('ops_entities')
          .update({ lead_id: lead.id, updated_at: new Date().toISOString() })
          .eq('id', byName.id);
      }
      return { id: byName.id as string };
    }
  }

  const entityType = entityTypeForDealPath(lead.deal_path);
  const { data: created, error } = await service
    .from('ops_entities')
    .insert({
      name: entityName,
      entity_type: entityType,
      status: entityType === 'launch' ? 'forming' : 'active',
      lead_id: lead.id,
      notes: `Auto-provisioned on closed_won for deal ${lead.id}`,
      created_by: createdBy,
    })
    .select('id')
    .single();

  if (error) {
    console.error('closed_won portfolio entity provision failed', error);
    return null;
  }

  // Folders (same as client createEntity) — checklist optional
  const { data: defaults } = await service
    .from('ops_default_folders')
    .select('name, sort_order')
    .order('sort_order');
  if (defaults?.length && created?.id) {
    await service.from('ops_folders').insert(
      defaults.map((f: { name: string; sort_order: number }) => ({
        entity_id: created.id,
        name: f.name,
        sort_order: f.sort_order,
      })),
    );
  }

  return created?.id ? { id: created.id as string } : null;
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
    if (body.contact_id !== undefined) patch.contact_id = body.contact_id;
    if (body.account_id !== undefined) patch.account_id = body.account_id;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.next_action_at !== undefined) patch.next_action_at = body.next_action_at;
    if (body.assigned_rep_id !== undefined) {
      patch.assigned_rep_id = body.assigned_rep_id;
    }

    // Contact is source of truth for identity — write-back name/email/phone.
    const identityTouched =
      body.name !== undefined || body.email !== undefined || body.phone !== undefined;
    if (identityTouched) {
      const nextName =
        body.name !== undefined ? String(body.name).trim() : String(existing.name ?? '');
      const nextEmail =
        body.email !== undefined
          ? String(body.email).trim().toLowerCase()
          : String(existing.email ?? '').trim().toLowerCase();
      const nextPhone =
        body.phone !== undefined
          ? String(body.phone).trim()
          : String(existing.phone ?? '').trim();
      const accountId =
        body.account_id !== undefined ? body.account_id : existing.account_id;
      let contactId =
        body.contact_id !== undefined ? body.contact_id : existing.contact_id;

      if (contactId) {
        const contactPatch: Record<string, unknown> = {};
        if (body.name !== undefined) contactPatch.full_name = nextName || 'Unknown';
        if (body.email !== undefined) {
          contactPatch.primary_email = nextEmail;
          contactPatch.emails = nextEmail ? [nextEmail] : [];
        }
        if (body.phone !== undefined) {
          contactPatch.primary_phone = nextPhone;
          contactPatch.phones = nextPhone ? [nextPhone] : [];
        }
        if (accountId && body.account_id !== undefined) {
          contactPatch.account_id = accountId;
        }
        if (Object.keys(contactPatch).length > 0) {
          const { error: contactErr } = await service
            .from('sales_contacts')
            .update(contactPatch)
            .eq('id', contactId);
          if (contactErr) {
            console.error('update-lead contact write-back', contactErr);
          }
        }
      } else if (nextName || nextEmail || nextPhone) {
        const { data: created, error: createErr } = await service
          .from('sales_contacts')
          .insert({
            full_name: nextName || nextEmail || 'Unknown',
            primary_email: nextEmail,
            primary_phone: nextPhone,
            emails: nextEmail ? [nextEmail] : [],
            phones: nextPhone ? [nextPhone] : [],
            account_id: accountId ?? null,
            company:
              body.company !== undefined
                ? String(body.company).trim()
                : String(existing.company ?? ''),
            created_by: salesUser.id,
          })
          .select('id')
          .single();
        if (createErr) {
          console.error('update-lead create contact', createErr);
        } else if (created?.id) {
          contactId = created.id;
          patch.contact_id = created.id;
        }
      }

      if (body.name === undefined && nextName) patch.name = nextName;
      if (body.email === undefined && nextEmail) patch.email = nextEmail;
      if (body.phone === undefined && nextPhone) patch.phone = nextPhone;
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
      .select(
        '*, sales_contacts(id, full_name, primary_email, primary_phone, company, title, account_id), sales_accounts(id, name, account_type, website)',
      )
      .single();

    if (updateErr || !updated) {
      return jsonResponse({ error: updateErr?.message ?? 'Update failed' }, 500, origin);
    }

    if (body.stage && body.stage !== existing.stage) {
      await service.from('sales_lead_activities').insert({
        lead_id: updated.id,
        contact_id: updated.contact_id ?? existing.contact_id ?? null,
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

      // Auto-provision Manage Portfolio entity shell on closed_won.
      // DB triggers also seed finance/legal/HR/marketing/tech + Leadership/KPIs.
      if (body.stage === 'closed_won') {
        const provisioned = await ensurePortfolioEntityForClosedDeal(
          service,
          updated,
          salesUser.id as string,
        );
        if (provisioned) {
          (updated as Record<string, unknown>).portfolio_entity_id =
            provisioned.id;
        }
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
