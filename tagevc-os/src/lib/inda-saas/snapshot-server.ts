/**
 * Tage parent reader for Instant NDA SaaS KPIs (same UDL tables as the portal).
 * Fail soft when tables are missing or empty.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  INDA_COMPANY_NAME,
  INDA_ENTITY_ID,
  INDA_SAAS_KPI_DICTIONARY,
  kpiById,
  type KpiDataState,
} from '@/lib/inda-saas/dictionary';

export type ParentKpiActual = {
  kpi_id: string;
  name: string;
  plain_definition: string;
  actual: string | number | null;
  goal: string | null;
  variance_label: string;
  data_state: KpiDataState;
  company_name: string;
};

export type IndaParentSnapshot = {
  company_name: string;
  entity_id: string;
  generated_at: string;
  freshness: 'live' | 'partial' | 'missing';
  metrics: Record<string, ParentKpiActual>;
  source_note: string;
};

function moneyFromCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function empty(
  id: string,
  state: KpiDataState,
  asOf: string,
): ParentKpiActual {
  const def = kpiById(id);
  return {
    kpi_id: id,
    name: def?.name ?? id,
    plain_definition: def?.plain_definition ?? '',
    actual: null,
    goal: null,
    variance_label: 'Goal not set',
    data_state: state,
    company_name: INDA_COMPANY_NAME,
  };
}

export async function buildIndaParentSaasSnapshot(): Promise<IndaParentSnapshot> {
  const asOf = new Date().toISOString();
  const metrics: Record<string, ParentKpiActual> = {};
  for (const def of INDA_SAAS_KPI_DICTIONARY) {
    metrics[def.kpi_id] = empty(def.kpi_id, 'not_connected', asOf);
  }

  try {
    const sb = await createPersistClient();
    const [
      mrrRows,
      active,
      trials,
      pastDue,
      accounts,
      leads,
      ndaEvents,
      tickets,
      goals,
    ] = await Promise.all([
      sb
        .from('inda_subscriptions')
        .select('mrr_cents')
        .eq('entity_id', INDA_ENTITY_ID)
        .eq('status', 'active'),
      sb
        .from('inda_subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('entity_id', INDA_ENTITY_ID)
        .eq('status', 'active'),
      sb
        .from('inda_subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('entity_id', INDA_ENTITY_ID)
        .eq('status', 'trialing'),
      sb
        .from('inda_subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('entity_id', INDA_ENTITY_ID)
        .eq('status', 'past_due'),
      sb
        .from('inda_accounts')
        .select('id', { count: 'exact', head: true })
        .eq('entity_id', INDA_ENTITY_ID),
      sb
        .from('inda_leads')
        .select('id', { count: 'exact', head: true })
        .eq('entity_id', INDA_ENTITY_ID)
        .neq('status', 'converted'),
      sb
        .from('inda_nda_events')
        .select('id', { count: 'exact', head: true })
        .eq('entity_id', INDA_ENTITY_ID),
      sb
        .from('inda_ss_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('entity_id', INDA_ENTITY_ID)
        .in('status', ['open', 'in_progress', 'waiting']),
      sb
        .from('inda_kpi_goals')
        .select('kpi_id, target_value, target_label')
        .eq('entity_id', INDA_ENTITY_ID)
        .eq('period_key', 'current_month')
        .limit(100),
    ]);

    if (mrrRows.error && active.error) {
      return {
        company_name: INDA_COMPANY_NAME,
        entity_id: INDA_ENTITY_ID,
        generated_at: asOf,
        freshness: 'missing',
        metrics,
        source_note:
          'Instant NDA spine tables not readable yet — open portal.instantnda.us for live ops.',
      };
    }

    const mrrCents = (mrrRows.data ?? []).reduce(
      (s, r) => s + (Number(r.mrr_cents) || 0),
      0,
    );
    const patch = (
      id: string,
      actual: string | number | null,
      state: KpiDataState = 'live',
    ) => {
      metrics[id] = {
        ...empty(id, state, asOf),
        actual,
        data_state: state,
      };
    };

    patch('mrr', moneyFromCents(mrrCents));
    patch('arr', moneyFromCents(mrrCents * 12));
    patch('active_subscriptions', (active.count ?? 0) + (trials.count ?? 0));
    patch('trialing_accounts', trials.count ?? 0);
    patch('past_due', pastDue.count ?? 0);
    patch('active_accounts_30d', accounts.count ?? 0, 'partial');
    patch('sales_assisted_pipeline', `${leads.count ?? 0} open leads`, 'partial');
    patch('ndas_created', ndaEvents.count ?? 0, 'partial');
    patch('tickets_opened', tickets.count ?? 0);

    for (const g of goals.data ?? []) {
      const id = String(g.kpi_id);
      if (!metrics[id]) continue;
      metrics[id] = {
        ...metrics[id],
        goal: String(g.target_label ?? g.target_value),
        variance_label: 'Goal set',
      };
    }

    return {
      company_name: INDA_COMPANY_NAME,
      entity_id: INDA_ENTITY_ID,
      generated_at: asOf,
      freshness: 'live',
      metrics,
      source_note: 'Live from Instant NDA UDL spine (inda_* tables).',
    };
  } catch (err) {
    return {
      company_name: INDA_COMPANY_NAME,
      entity_id: INDA_ENTITY_ID,
      generated_at: asOf,
      freshness: 'missing',
      metrics,
      source_note:
        err instanceof Error
          ? err.message
          : 'Could not load Instant NDA SaaS metrics',
    };
  }
}
