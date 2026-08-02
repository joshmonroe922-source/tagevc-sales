/**
 * Graph repos — service-role persist client (worker / server actions).
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { websiteRoutingKey } from '@/lib/spine/enrichment/jobs';

function domainFromWebsite(website?: string | null, company?: string | null): string | null {
  const raw = (website || '').trim() || (company || '').trim();
  if (!raw) return null;
  try {
    const withProto = raw.includes('://') ? raw : `https://${raw}`;
    const host = new URL(withProto).hostname.replace(/^www\./, '').toLowerCase();
    if (host.includes('.')) return host;
  } catch {
    /* fall through */
  }
  const slug = company
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug ? `${slug}.com` : null;
}

export async function resolveOrgIdBySlug(slug: string): Promise<string | null> {
  try {
    const sb = await createPersistClient();
    const { data } = await sb
      .from('organizations')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    return data?.id ?? null;
  } catch {
    return null;
  }
}

export type WebsiteGraphBootstrapInput = {
  leadId: string;
  name: string;
  email?: string | null;
  company?: string | null;
  website?: string | null;
  orgSlug?: string;
};

export type WebsiteGraphBootstrapResult =
  | {
      ok: true;
      accountId: string;
      contactId: string;
      orgId: string;
      jobId: string | null;
      replay: boolean;
    }
  | { ok: false; error: string };

/**
 * Bootstrap graph account + contact from website lead (agent.routing seam).
 * Idempotent per lead/day via enrichment_jobs key.
 */
export async function bootstrapGraphFromWebsiteLead(
  input: WebsiteGraphBootstrapInput,
): Promise<WebsiteGraphBootstrapResult> {
  const orgSlug = input.orgSlug || 'tage';
  try {
    const sb = await createPersistClient();
    const orgId = await resolveOrgIdBySlug(orgSlug);
    if (!orgId) {
      return {
        ok: false,
        error: `organizations.${orgSlug} missing — apply phase94_graph_spine.sql`,
      };
    }

    const idem = websiteRoutingKey(input.leadId);
    const existingJob = await sb
      .from('enrichment_jobs')
      .select('id, payload, status')
      .eq('idempotency_key', idem)
      .maybeSingle();
    if (existingJob.data?.payload) {
      const p = existingJob.data.payload as {
        account_id?: string;
        contact_id?: string;
      };
      if (p.account_id && p.contact_id) {
        return {
          ok: true,
          accountId: p.account_id,
          contactId: p.contact_id,
          orgId,
          jobId: existingJob.data.id,
          replay: true,
        };
      }
    }

    const domain = domainFromWebsite(input.website, input.company);
    const companyName = (input.company || domain || 'Unknown company').trim();

    let accountId: string | null = null;
    if (domain) {
      const found = await sb
        .from('accounts')
        .select('id')
        .eq('canonical_domain', domain)
        .maybeSingle();
      accountId = found.data?.id ?? null;
    }
    if (!accountId) {
      const { data: acc, error } = await sb
        .from('accounts')
        .insert({
          name: companyName,
          canonical_domain: domain,
          website: input.website || (domain ? `https://${domain}` : null),
          enrich_status: 'pending',
        })
        .select('id')
        .single();
      if (error || !acc) {
        return { ok: false, error: error?.message || 'account_insert_failed' };
      }
      accountId = acc.id;
    }

    await sb.from('account_org_links').upsert(
      {
        account_id: accountId,
        org_id: orgId,
        visibility: 'org',
        is_primary: true,
      },
      { onConflict: 'account_id,org_id' },
    );

    const email = (input.email || '').trim().toLowerCase() || null;
    let contactId: string | null = null;
    if (email) {
      const found = await sb
        .from('contacts')
        .select('id')
        .ilike('primary_email', email)
        .maybeSingle();
      contactId = found.data?.id ?? null;
    }
    if (!contactId) {
      const parts = input.name.trim().split(/\s+/);
      const { data: c, error } = await sb
        .from('contacts')
        .insert({
          full_name: input.name.trim(),
          first_name: parts[0] || null,
          last_name: parts.slice(1).join(' ') || null,
          primary_email: email,
          primary_email_status: email ? 'unknown' : 'unknown',
          enrich_status: 'pending',
        })
        .select('id')
        .single();
      if (error || !c) {
        return { ok: false, error: error?.message || 'contact_insert_failed' };
      }
      contactId = c.id;
    }

    await sb.from('contact_org_links').upsert(
      {
        contact_id: contactId,
        org_id: orgId,
        visibility: 'org',
        is_primary: true,
      },
      { onConflict: 'contact_id,org_id' },
    );

    await sb.from('employments').upsert(
      {
        contact_id: contactId,
        account_id: accountId,
        is_current: true,
        source: 'website_intake',
      },
      { onConflict: 'contact_id,account_id' },
    ).then(() => undefined).catch(async () => {
      // unique index is partial; fall back to insert-ignore
      await sb.from('employments').insert({
        contact_id: contactId,
        account_id: accountId,
        is_current: true,
        source: 'website_intake',
      });
    });

    const { data: job } = await sb
      .from('enrichment_jobs')
      .upsert(
        {
          org_id: orgId,
          type: 'agent.routing',
          payload: {
            lead_id: input.leadId,
            account_id: accountId,
            contact_id: contactId,
            org_id: orgId,
            source: 'website_intake',
          },
          idempotency_key: idem,
          account_id: accountId,
          contact_id: contactId,
          status: 'succeeded',
          progress_pct: 100,
          progress_message: 'Graph bootstrap from website intake',
          finished_at: new Date().toISOString(),
        },
        { onConflict: 'idempotency_key' },
      )
      .select('id')
      .maybeSingle();

    await sb.from('activities').insert({
      org_id: orgId,
      account_id: accountId,
      contact_id: contactId,
      kind: 'website_lead_bootstrapped',
      body: `Lead ${input.leadId} → graph`,
      meta: { lead_id: input.leadId },
    });

    return {
      ok: true,
      accountId,
      contactId,
      orgId,
      jobId: job?.id ?? null,
      replay: false,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'graph_bootstrap_failed',
    };
  }
}
