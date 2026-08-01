/**
 * Partner spine repository — fail-soft when phase89 tables are not applied yet.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { PARTNER_CATALOG, type PartnerKey } from '@/lib/partners/catalog';
import { entityCreatePartnerPlan } from '@/lib/partners/registry';
import type {
  CommissionPayrollStub,
  MarketingPresenceProperty,
  PartnerBiSignal,
  PartnerEntityBinding,
  PartnerEvent,
  PartnerVendorContract,
  PartnerVendorPayment,
} from '@/lib/partners/types';

export async function listPartnerBindings(
  entityId?: string | null,
): Promise<PartnerEntityBinding[]> {
  try {
    const sb = await createPersistClient();
    let q = sb.from('os_partner_entity_bindings').select('*').order('partner_key');
    if (entityId) q = q.eq('entity_id', entityId);
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as PartnerEntityBinding[];
  } catch {
    return [];
  }
}

export async function ensureEntityPartnerBindings(
  entityId: string,
): Promise<{ created: number; plan: ReturnType<typeof entityCreatePartnerPlan> }> {
  const plan = entityCreatePartnerPlan(entityId);
  try {
    const sb = await createPersistClient();
    const rows = plan.map((p) => ({
      partner_key: p.partner_key,
      entity_id: entityId,
      enabled: p.enabled,
      status: p.status,
      config: p.lifecycle_hook
        ? { entity_create_hook: p.lifecycle_hook }
        : {},
    }));
    const { data, error } = await sb
      .from('os_partner_entity_bindings')
      .upsert(rows, { onConflict: 'partner_key,entity_id' })
      .select('id');
    if (error) return { created: 0, plan };
    return { created: data?.length ?? 0, plan };
  } catch {
    return { created: 0, plan };
  }
}

export async function listVendorContracts(
  entityId?: string | null,
): Promise<PartnerVendorContract[]> {
  try {
    const sb = await createPersistClient();
    let q = sb
      .from('os_partner_vendor_contracts')
      .select('*')
      .order('ends_on', { ascending: true, nullsFirst: false });
    if (entityId) q = q.or(`entity_id.eq.${entityId},entity_id.is.null`);
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as PartnerVendorContract[];
  } catch {
    return [];
  }
}

export async function listVendorPayments(
  contractId?: string | null,
): Promise<PartnerVendorPayment[]> {
  try {
    const sb = await createPersistClient();
    let q = sb
      .from('os_partner_vendor_payments')
      .select('*')
      .order('paid_on', { ascending: false });
    if (contractId) q = q.eq('contract_id', contractId);
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as PartnerVendorPayment[];
  } catch {
    return [];
  }
}

export async function upsertVendorContract(
  row: Partial<PartnerVendorContract> & {
    partner_key: PartnerKey;
    vendor_name: string;
    contract_title: string;
  },
): Promise<PartnerVendorContract | null> {
  try {
    const sb = await createPersistClient();
    const payload = {
      ...row,
      updated_at: new Date().toISOString(),
    };
    const q = row.id
      ? sb.from('os_partner_vendor_contracts').update(payload).eq('id', row.id)
      : sb.from('os_partner_vendor_contracts').insert(payload);
    const { data, error } = await q.select('*').maybeSingle();
    if (error) return null;
    return data as PartnerVendorContract;
  } catch {
    return null;
  }
}

export async function upsertVendorPayment(input: {
  contract_id: string;
  paid_on: string;
  amount_cents: number;
  currency?: string;
  reference?: string | null;
  notes?: string | null;
}): Promise<PartnerVendorPayment | null> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_partner_vendor_payments')
      .insert({
        contract_id: input.contract_id,
        paid_on: input.paid_on,
        amount_cents: input.amount_cents,
        currency: input.currency ?? 'USD',
        reference: input.reference ?? null,
        notes: input.notes ?? null,
      })
      .select('*')
      .maybeSingle();
    if (error) return null;
    return data as PartnerVendorPayment;
  } catch {
    return null;
  }
}

export async function listMarketingPresence(
  entityId?: string | null,
): Promise<MarketingPresenceProperty[]> {
  try {
    const sb = await createPersistClient();
    let q = sb
      .from('os_marketing_presence_properties')
      .select('*')
      .order('kind');
    if (entityId) q = q.eq('entity_id', entityId);
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as MarketingPresenceProperty[];
  } catch {
    return [];
  }
}

export async function ensureMarketingPresenceSlots(
  entityId: string,
  entityLabel: string,
): Promise<number> {
  const kinds = [
    'google_business',
    'google_analytics',
    'linkedin_company',
  ] as const;
  try {
    const sb = await createPersistClient();
    const rows = kinds.map((kind) => ({
      kind,
      entity_id: entityId,
      label: `${entityLabel} · ${kind.replace(/_/g, ' ')}`,
      status: 'scaffolded',
      config: {},
    }));
    const { data, error } = await sb
      .from('os_marketing_presence_properties')
      .upsert(rows, { onConflict: 'kind,entity_id' })
      .select('id');
    if (error) return 0;
    return data?.length ?? 0;
  } catch {
    return 0;
  }
}

export async function recordPartnerEvent(input: {
  partner_key: PartnerKey;
  entity_id?: string | null;
  kind: PartnerEvent['kind'];
  status?: PartnerEvent['status'];
  external_id?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    const sb = await createPersistClient();
    await sb.from('os_partner_events').insert({
      partner_key: input.partner_key,
      entity_id: input.entity_id ?? null,
      kind: input.kind,
      status: input.status ?? 'received',
      external_id: input.external_id ?? null,
      payload: input.payload ?? {},
    });
  } catch {
    /* fail-soft */
  }
}

export async function listBiSignals(opts?: {
  limit?: number;
  entityId?: string | null;
}): Promise<PartnerBiSignal[]> {
  try {
    const sb = await createPersistClient();
    let q = sb
      .from('os_partner_bi_signals')
      .select('*')
      .order('observed_at', { ascending: false })
      .limit(opts?.limit ?? 100);
    if (opts?.entityId) q = q.eq('entity_id', opts.entityId);
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as PartnerBiSignal[];
  } catch {
    return [];
  }
}

export async function listCommissionStubs(
  entityId?: string | null,
): Promise<CommissionPayrollStub[]> {
  try {
    const sb = await createPersistClient();
    let q = sb
      .from('os_gusto_commission_stubs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (entityId) q = q.eq('entity_id', entityId);
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as CommissionPayrollStub[];
  } catch {
    return [];
  }
}

/** Alias for Technology UI (parallel consumers). */
export async function listPartnerContracts(entityId?: string | null) {
  const rows = await listVendorContracts(entityId);
  return { rows, error: null as string | null };
}

/** Alias for Technology UI (parallel consumers). */
export async function listPartnerEnablements(entityId?: string | null) {
  const rows = await listPartnerBindings(entityId);
  return { rows, error: null as string | null };
}

/** Catalog-backed technology stack rows for admin UI (contracts overlay when present). */
export async function getTechnologyStackView(entityId?: string | null) {
  const [bindings, contracts] = await Promise.all([
    listPartnerBindings(entityId),
    listVendorContracts(entityId),
  ]);
  const byKey = new Map(bindings.map((b) => [b.partner_key, b]));
  return PARTNER_CATALOG.map((def) => {
    const binding = byKey.get(def.key) ?? null;
    const partnerContracts = contracts.filter((c) => c.partner_key === def.key);
    const soonestEnd =
      partnerContracts
        .map((c) => c.ends_on)
        .filter(Boolean)
        .sort()[0] ?? null;
    return {
      def,
      binding,
      contracts: partnerContracts,
      nextExpiration: soonestEnd,
    };
  });
}
