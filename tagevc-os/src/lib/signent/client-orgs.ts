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
