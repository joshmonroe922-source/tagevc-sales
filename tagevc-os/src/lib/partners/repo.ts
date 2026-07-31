/**
 * Partner spine persistence — fail-soft when phase89 SQL not applied.
 */

import { PARTNER_CATALOG } from '@/lib/partners/catalog';
import { listPartnerRuntimeStatuses } from '@/lib/partners/env';
import {
  buildPartnerSpineProvisionPlan,
  provisionPlanRows,
} from '@/lib/partners/provision';
import type {
  MarketingPresenceProperty,
  PartnerBiInsight,
  PartnerContract,
  PartnerEntityEnablement,
  PartnerKey,
} from '@/lib/partners/types';
import { createClient } from '@/lib/supabase/server';

function emptyEnablements(entityId?: string | null): PartnerEntityEnablement[] {
  const entities = entityId
    ? [entityId]
    : ['ENT-FIRM', 'ENT-R619', 'ENT-SIGNENT', 'ENT-INDA'];
  const now = new Date().toISOString();
  return entities.flatMap((eid) =>
    PARTNER_CATALOG.map((p) => ({
      id: `local:${p.key}:${eid}`,
      partner_key: p.key,
      entity_id: eid,
      enabled: true,
      status: 'scaffold' as const,
      external_account_ref: null,
      config_meta: {},
      notes: null,
      last_synced_at: null,
      updated_at: now,
    })),
  );
}

export async function listPartnerEnablements(opts?: {
  entityId?: string | null;
}): Promise<{ rows: PartnerEntityEnablement[]; error: string | null }> {
  try {
    const sb = await createClient();
    let q = sb.from('os_partner_entity_enablements').select('*').limit(500);
    if (opts?.entityId) q = q.eq('entity_id', opts.entityId);
    const { data, error } = await q;
    if (error) {
      return { rows: emptyEnablements(opts?.entityId), error: error.message };
    }
    if (!data?.length) {
      return { rows: emptyEnablements(opts?.entityId), error: null };
    }
    return {
      rows: data.map((r) => ({
        id: String(r.id),
        partner_key: r.partner_key as PartnerKey,
        entity_id: String(r.entity_id),
        enabled: Boolean(r.enabled),
        status: r.status,
        external_account_ref: r.external_account_ref ?? null,
        config_meta: (r.config_meta as Record<string, unknown>) ?? {},
        notes: r.notes ?? null,
        last_synced_at: r.last_synced_at ?? null,
        updated_at: r.updated_at,
      })),
      error: null,
    };
  } catch (e) {
    return {
      rows: emptyEnablements(opts?.entityId),
      error: e instanceof Error ? e.message : 'enablements unavailable',
    };
  }
}

export async function listPartnerContracts(): Promise<{
  rows: PartnerContract[];
  error: string | null;
}> {
  try {
    const sb = await createClient();
    const { data, error } = await sb
      .from('os_partner_contracts')
      .select('*')
      .order('ends_on', { ascending: true, nullsFirst: false })
      .limit(200);
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((r) => ({
        id: String(r.id),
        partner_key: r.partner_key as PartnerKey,
        entity_id: r.entity_id ?? null,
        vendor_name: String(r.vendor_name),
        contract_title: String(r.contract_title),
        status: r.status,
        starts_on: r.starts_on ?? null,
        ends_on: r.ends_on ?? null,
        renewal_on: r.renewal_on ?? null,
        payment_cadence: r.payment_cadence ?? null,
        payment_amount:
          r.payment_amount == null ? null : Number(r.payment_amount),
        payment_currency: String(r.payment_currency ?? 'USD'),
        storage_path: r.storage_path ?? null,
        notes: r.notes ?? null,
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
      error: null,
    };
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message : 'contracts unavailable',
    };
  }
}

export async function listMarketingPresence(opts?: {
  entityId?: string | null;
}): Promise<{ rows: MarketingPresenceProperty[]; error: string | null }> {
  try {
    const sb = await createClient();
    let q = sb.from('os_marketing_presence_properties').select('*').limit(200);
    if (opts?.entityId) q = q.eq('entity_id', opts.entityId);
    const { data, error } = await q.order('entity_id');
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((r) => ({
        id: String(r.id),
        entity_id: String(r.entity_id),
        kind: r.kind,
        display_name: String(r.display_name),
        external_id: r.external_id ?? null,
        property_url: r.property_url ?? null,
        status: r.status,
        config_meta: (r.config_meta as Record<string, unknown>) ?? {},
        last_imported_at: r.last_imported_at ?? null,
        updated_at: r.updated_at,
      })),
      error: null,
    };
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message : 'presence unavailable',
    };
  }
}

export async function provisionPartnerSpineForEntity(input: {
  entityId: string;
  displayName?: string;
}): Promise<{ ok: true; planned: number } | { ok: false; error: string }> {
  const plan = buildPartnerSpineProvisionPlan(
    input.entityId,
    input.displayName,
  );
  const rows = provisionPlanRows(plan);
  try {
    const sb = await createClient();
    const { error: e1 } = await sb
      .from('os_partner_entity_enablements')
      .upsert(rows.enablements, {
        onConflict: 'partner_key,entity_id',
      });
    if (e1) return { ok: false, error: e1.message };
    const { error: e2 } = await sb
      .from('os_marketing_presence_properties')
      .upsert(rows.presence, {
        onConflict: 'entity_id,kind',
      });
    if (e2) return { ok: false, error: e2.message };
    return {
      ok: true,
      planned: rows.enablements.length + rows.presence.length,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'provision failed',
    };
  }
}

export function buildPartnerBiInsights(input: {
  contracts: PartnerContract[];
  presence: MarketingPresenceProperty[];
}): PartnerBiInsight[] {
  const runtime = listPartnerRuntimeStatuses();
  const insights: PartnerBiInsight[] = [];

  for (const r of runtime) {
    if (r.status === 'scaffold' || r.status === 'not_configured') {
      insights.push({
        partner_key: r.key,
        title: `${r.name} not connected`,
        severity: 'watch',
        detail: r.setupNote,
        href: r.manageHref,
      });
    }
  }

  const soon = Date.now() + 60 * 24 * 60 * 60 * 1000;
  for (const c of input.contracts) {
    if (c.ends_on) {
      const end = Date.parse(c.ends_on);
      if (!Number.isNaN(end) && end < soon) {
        insights.push({
          partner_key: c.partner_key,
          title: `Contract expiring: ${c.contract_title}`,
          severity: end < Date.now() ? 'action' : 'watch',
          detail: `Ends ${c.ends_on}${c.payment_amount != null ? ` · ${c.payment_currency} ${c.payment_amount}` : ''}`,
          href: '/shared-services/it/technology',
        });
      }
    }
  }

  const missingPresence = input.presence.filter(
    (p) => p.status === 'scaffold' || !p.external_id,
  );
  if (missingPresence.length) {
    insights.push({
      partner_key: 'cross_cutting',
      title: `${missingPresence.length} Marketing presence slot(s) need connection`,
      severity: 'info',
      detail:
        'Google Business · GA4 · LinkedIn Company Pages — connect under Marketing Shared Services.',
      href: '/shared-services/marketing/presence',
    });
  }

  insights.push({
    partner_key: 'cross_cutting',
    title: 'Unified partner event bus ready',
    severity: 'info',
    detail:
      'os_partner_events accepts webhook/import rows for AI BI once LIVE adapters emit.',
    href: '/shared-services/bi',
  });

  return insights;
}
