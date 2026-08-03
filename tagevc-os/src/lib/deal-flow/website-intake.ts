/**
 * Website contact form → Tage OS deal-flow lead intake.
 */

import { createHash } from 'crypto';
import {
  createLead,
  hydrateDealFlowStore,
  listAllLeads,
} from '@/lib/data/deal-flow-store';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { bootstrapGraphFromWebsiteLead } from '@/lib/spine/db/repos';
import { resolveIntakeOrgSlug } from '@/lib/deal-flow/org-routing';
import type { DealPath } from '@/lib/types';

export type WebsiteIntakeBody = {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  deal_path?: string;
  source?: string;
  notes?: string;
  idempotency_key?: string;
  website?: string;
  enroll_drip?: boolean;
  /** Spine org: tage | recruit619 | signent | instant_nda */
  entity?: string;
  org_slug?: string;
};

export type WebsiteIntakeResult =
  | {
      ok: true;
      lead_id: string;
      replay: boolean;
      company_name: string;
      org_slug?: string;
    }
  | { ok: false; error: string; status: number };

const VALID_PATHS = new Set(['launch', 'partner', 'exit']);

function pathLabel(dealPath: string): DealPath {
  if (dealPath === 'partner') return 'Partner';
  if (dealPath === 'exit') return 'Exit';
  return 'Launch';
}

export function buildIdempotencyKey(input: {
  email: string;
  company: string;
  deal_path: string;
  client_key?: string;
  day?: string;
}): string {
  if (input.client_key?.trim()) {
    return input.client_key.trim().slice(0, 128);
  }
  const day = input.day ?? new Date().toISOString().slice(0, 10);
  const raw = [
    (input.email || '').toLowerCase().trim(),
    (input.company || '').toLowerCase().trim(),
    input.deal_path,
    day,
  ].join('|');
  return createHash('sha256').update(raw).digest('hex').slice(0, 64);
}

export async function ingestWebsiteLead(
  body: WebsiteIntakeBody,
): Promise<WebsiteIntakeResult> {
  const name = (body.name ?? '').trim();
  const email = (body.email ?? '').trim().toLowerCase();
  const phone = (body.phone ?? '').trim();
  const company = (body.company ?? '').trim();
  const notes = (body.notes ?? '').trim();
  const dealPath = (body.deal_path ?? 'launch').trim().toLowerCase();
  const source = (body.source ?? 'website_form').trim().toLowerCase();

  if (!name) {
    return { ok: false, error: 'name is required', status: 400 };
  }
  if (!email && !phone) {
    return {
      ok: false,
      error: 'email or phone is required',
      status: 400,
    };
  }
  if (!VALID_PATHS.has(dealPath)) {
    return {
      ok: false,
      error: 'deal_path must be launch, partner, or exit',
      status: 400,
    };
  }

  const companyName = company || `Unknown / ${name}`;
  const path = pathLabel(dealPath);
  const idempotencyKey = buildIdempotencyKey({
    email,
    company: companyName,
    deal_path: dealPath,
    client_key: body.idempotency_key,
  });

  try {
    await hydrateDealFlowStore();
  } catch {
    /* continue with memory store */
  }

  try {
    const sb = await createPersistClient();
    const { data: existing } = await sb
      .from('os_website_intake_receipts')
      .select('lead_id, company_name')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (existing?.lead_id) {
      return {
        ok: true,
        lead_id: String(existing.lead_id),
        replay: true,
        company_name: String(existing.company_name || companyName),
      };
    }
  } catch {
    /* table may be missing — fall through; in-memory dedupe below */
    const dup = listAllLeads().find(
      (l) =>
        !l.archived_at &&
        l.source === 'Inbound' &&
        (l.source_detail ?? '').includes('website_form') &&
        l.company_name.toLowerCase() === companyName.toLowerCase() &&
        (l.notes ?? '').toLowerCase().includes(email || phone) &&
        l.created_at.slice(0, 10) === new Date().toISOString().slice(0, 10),
    );
    if (dup) {
      return {
        ok: true,
        lead_id: dup.lead_id,
        replay: true,
        company_name: dup.company_name,
      };
    }
  }

  const contactBits = [
    `Contact: ${name}`,
    email ? `Email: ${email}` : null,
    phone ? `Phone: ${phone}` : null,
    `Path: ${path}`,
    `Medium: website_form`,
    `Received: ${new Date().toISOString()}`,
    notes ? `Notes: ${notes}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const lead = createLead({
    company_name: companyName,
    website: body.website?.trim() || undefined,
    source: 'Inbound',
    source_detail: `website_form · ${path}`,
    path,
    owner: 'Associate',
    notes: contactBits,
  });

  try {
    const sb = await createPersistClient();
    await sb.from('os_website_intake_receipts').insert({
      idempotency_key: idempotencyKey,
      lead_id: lead.lead_id,
      company_name: companyName,
      email,
      deal_path: dealPath,
      source,
      payload: {
        name,
        email,
        phone,
        company: companyName,
        deal_path: dealPath,
        notes,
      },
    });
  } catch {
    /* soft — lead already created */
  }

  if (process.env.FORWARD_LEGACY_INTAKE === '1') {
    void forwardLegacyIntake({
      name,
      email,
      phone,
      company: companyName,
      deal_path: dealPath,
      notes,
      enroll_drip: body.enroll_drip !== false,
    });
  }

  // Best-effort graph bootstrap (agent.routing) — never fail website intake
  const orgSlug = resolveIntakeOrgSlug({
    entity: body.entity,
    org_slug: body.org_slug,
    source: body.source,
    deal_path: dealPath,
  });
  void bootstrapGraphFromWebsiteLead({
    leadId: lead.lead_id,
    name,
    email,
    company: companyName,
    website: body.website?.trim() || null,
    orgSlug,
  }).catch(() => undefined);

  return {
    ok: true,
    lead_id: lead.lead_id,
    replay: false,
    company_name: companyName,
    org_slug: orgSlug,
  };
}

async function forwardLegacyIntake(body: Record<string, unknown>) {
  try {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!base || !key) return;
    await fetch(`${base}/functions/v1/intake-lead`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        apikey: key,
      },
      body: JSON.stringify({ ...body, source: 'website_form' }),
    });
  } catch {
    /* never fail primary intake */
  }
}
