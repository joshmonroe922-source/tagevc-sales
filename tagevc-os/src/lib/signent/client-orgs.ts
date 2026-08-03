/**
 * Signent client org seams — empty tenancy (D02=A).
 * Never invent fake clients; rows appear when sales converts a real purchase.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';

export const SIGNENT_PORTAL_URL = 'https://portal.signenthr.com';
export const SIGNENT_MARKETING_URL = 'https://www.signenthr.com';

export type SignentClientOrgStatus =
  | 'prospect'
  | 'active'
  | 'paused'
  | 'churned'
  | 'archived';

export type SignentClientOrg = {
  id: string;
  legal_name: string;
  trade_name: string;
  status: SignentClientOrgStatus;
  portal_url: string | null;
  purchased_product_keys: string[];
  created_at: string;
};

export async function listSignentClientOrgs(opts?: {
  status?: SignentClientOrgStatus;
  limit?: number;
}): Promise<{ rows: SignentClientOrg[]; error?: string }> {
  try {
    const sb = await createPersistClient();
    let q = sb
      .from('os_signent_client_orgs')
      .select(
        'id, legal_name, trade_name, status, portal_url, purchased_product_keys, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(opts?.limit ?? 50);
    if (opts?.status) q = q.eq('status', opts.status);
    const { data, error } = await q;
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((r) => ({
        id: String(r.id),
        legal_name: String(r.legal_name),
        trade_name: String(r.trade_name ?? ''),
        status: r.status as SignentClientOrgStatus,
        portal_url: r.portal_url ? String(r.portal_url) : null,
        purchased_product_keys: Array.isArray(r.purchased_product_keys)
          ? (r.purchased_product_keys as string[])
          : [],
        created_at: String(r.created_at),
      })),
    };
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message : 'Client orgs unavailable',
    };
  }
}

/** Architecture constants — sales vs ops portals on Signent desk. */
export const SIGNENT_PORTAL_ROLES = {
  sales: {
    path: '/sales',
    purpose: 'Feature select → purchase → invoice → client convert',
  },
  operations: {
    path: '/ops',
    purpose: 'Deliver products, electronic audit, AI findings, upsell proposals',
  },
} as const;

export type ConvertSalesToClientInput = {
  legalName: string;
  tradeName?: string;
  productKeys: string[];
  salesOwnerProfileId?: string | null;
  /** Optional graph account to link via meta */
  accountId?: string | null;
  primaryContactEmail?: string | null;
  invoiceRef?: string | null;
};

/**
 * Sales → Ops convert: create a real client_org row (never invent demo clients).
 * Requires a legal name + at least one purchased product key from a paid path.
 */
export async function convertSalesPurchaseToClientOrg(
  input: ConvertSalesToClientInput,
): Promise<
  | { ok: true; clientOrg: SignentClientOrg }
  | { ok: false; error: string }
> {
  const legalName = input.legalName.trim();
  const products = input.productKeys.map((p) => p.trim()).filter(Boolean);
  if (!legalName) return { ok: false, error: 'legal_name required' };
  if (!products.length) {
    return {
      ok: false,
      error: 'purchased_product_keys required — convert only after purchase',
    };
  }

  try {
    const sb = await createPersistClient();
    const portalPath = `${SIGNENT_PORTAL_URL}/ops/clients`;
    const { data, error } = await sb
      .from('os_signent_client_orgs')
      .insert({
        legal_name: legalName,
        trade_name: (input.tradeName || legalName).trim(),
        status: 'active',
        portal_url: portalPath,
        sales_owner_profile_id: input.salesOwnerProfileId || null,
        purchased_product_keys: products,
        meta: {
          converted_at: new Date().toISOString(),
          account_id: input.accountId || null,
          primary_contact_email: input.primaryContactEmail || null,
          invoice_ref: input.invoiceRef || null,
          source: 'sales_convert',
        },
      })
      .select(
        'id, legal_name, trade_name, status, portal_url, purchased_product_keys, created_at',
      )
      .single();

    if (error || !data) {
      return { ok: false, error: error?.message || 'insert failed' };
    }

    // Optional spine engagement link (does not invent clients on graph)
    if (input.accountId) {
      try {
        const { data: org } = await sb
          .from('organizations')
          .select('id')
          .eq('slug', 'signent')
          .maybeSingle();
        if (org?.id) {
          await sb.from('spine_signent_engagements').insert({
            org_id: org.id,
            account_id: input.accountId,
            client_org_id: data.id,
            status: 'active',
            notes: `Converted products: ${products.join(', ')}`,
          });
        }
      } catch {
        /* soft */
      }
    }

    return {
      ok: true,
      clientOrg: {
        id: String(data.id),
        legal_name: String(data.legal_name),
        trade_name: String(data.trade_name ?? ''),
        status: data.status as SignentClientOrgStatus,
        portal_url: data.portal_url ? String(data.portal_url) : null,
        purchased_product_keys: Array.isArray(data.purchased_product_keys)
          ? (data.purchased_product_keys as string[])
          : [],
        created_at: String(data.created_at),
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'convert failed',
    };
  }
}

/** Ops module seams — honest status for portal.signenthr.com/ops */
export const SIGNENT_OPS_MODULES = [
  {
    id: 'client_workspace',
    label: 'Client workspace',
    status: 'ready' as const,
    href: `${SIGNENT_PORTAL_URL}/ops`,
    note: 'Empty until convertSalesPurchaseToClientOrg runs',
  },
  {
    id: 'handbook_autofill',
    label: 'Handbook / form autofill',
    status: 'scaffold' as const,
    href: `${SIGNENT_PORTAL_URL}/ops`,
    note: 'Merge from client_org + graph contacts',
  },
  {
    id: 'electronic_audit',
    label: 'Electronic HR audit',
    status: 'scaffold' as const,
    href: `${SIGNENT_PORTAL_URL}/ops`,
    note: 'AI findings gated — ops edit before client share',
  },
  {
    id: 'upsell',
    label: 'Upsell proposals',
    status: 'scaffold' as const,
    href: `${SIGNENT_PORTAL_URL}/sales`,
    note: 'LTV after delivery evidence',
  },
] as const;

export async function getSignentClientOrg(
  id: string,
): Promise<{ row: SignentClientOrg | null; error?: string; meta?: Record<string, unknown> }> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_signent_client_orgs')
      .select(
        'id, legal_name, trade_name, status, portal_url, purchased_product_keys, created_at, meta',
      )
      .eq('id', id)
      .maybeSingle();
    if (error) return { row: null, error: error.message };
    if (!data) return { row: null };
    return {
      row: {
        id: String(data.id),
        legal_name: String(data.legal_name),
        trade_name: String(data.trade_name ?? ''),
        status: data.status as SignentClientOrgStatus,
        portal_url: data.portal_url ? String(data.portal_url) : null,
        purchased_product_keys: Array.isArray(data.purchased_product_keys)
          ? (data.purchased_product_keys as string[])
          : [],
        created_at: String(data.created_at),
      },
      meta:
        data.meta && typeof data.meta === 'object'
          ? (data.meta as Record<string, unknown>)
          : {},
    };
  } catch (e) {
    return {
      row: null,
      error: e instanceof Error ? e.message : 'client_org unavailable',
    };
  }
}

/** Ops UX scaffolds — real pages in Tage OS; delivery still on Signent portal. */
export function buildSignentOpsScaffold(clientOrgId: string) {
  return [
    {
      id: 'handbook',
      title: 'Handbook / form autofill',
      status: 'scaffold' as const,
      summary:
        'Pull legal name, contacts, and purchased product keys into handbook merge fields. No auto-send.',
      next: [
        'Confirm primary contact email',
        'Map product keys → handbook sections',
        'Human review before client share',
      ],
      portalHref: `${SIGNENT_PORTAL_URL}/ops/clients/${clientOrgId}/handbook`,
    },
    {
      id: 'audit',
      title: 'Electronic HR audit',
      status: 'scaffold' as const,
      summary:
        'AI findings stay ops-gated. Tage OS tracks status; Signent portal runs the audit workspace.',
      next: [
        'Collect handbook + policy artifacts',
        'Run findings draft (ops edit)',
        'Share pack only after ops approval',
      ],
      portalHref: `${SIGNENT_PORTAL_URL}/ops/clients/${clientOrgId}/audit`,
    },
    {
      id: 'upsell',
      title: 'Upsell vision',
      status: 'scaffold' as const,
      summary:
        'LTV proposals after delivery evidence — never invent products the client did not purchase.',
      next: [
        'Require delivered product keys',
        'Score gaps vs catalog',
        'Sales owner reviews proposal',
      ],
      portalHref: `${SIGNENT_PORTAL_URL}/sales/clients/${clientOrgId}/upsell`,
    },
  ] as const;
}
