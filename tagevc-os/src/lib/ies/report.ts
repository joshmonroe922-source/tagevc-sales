/**
 * IES consolidated + by-company report for Finance control plane.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { entityDisplayName } from '@/lib/entities/display-name';
import {
  getIesConfig,
  IES_OPERATING_ENTITIES,
  IES_SECRETS_DOC,
  PHASE70_IES_CONTRACT_VERSION,
} from '@/lib/ies/config';
import { listIesConnections } from '@/lib/ies/oauth';

export type IesEntityFinanceRow = {
  entity_id: string;
  company_name: string;
  realm_id: string | null;
  ies_company_name: string | null;
  mapped: boolean;
  feed_status: 'ok' | 'partial' | 'missing' | 'unknown';
  cash_on_hand: number | null;
  ar_balance: number | null;
  ap_balance: number | null;
  burn_rate_monthly: number | null;
  open_invoices: number | null;
  overdue_invoices: number | null;
  open_invoice_balance: number | null;
  coa_account_count: number | null;
  coa_by_type: Record<string, number>;
  as_of: string | null;
  todo: string | null;
};

export type IesFinanceReport = {
  configured: boolean;
  missing_secrets: string[];
  secrets_doc: readonly string[];
  connections: Awaited<ReturnType<typeof listIesConnections>>;
  companies: IesEntityFinanceRow[];
  consolidated: {
    cash_on_hand: number | null;
    ar_balance: number | null;
    ap_balance: number | null;
    open_invoices: number | null;
    overdue_invoices: number | null;
    as_of: string | null;
    feed_status: 'ok' | 'partial' | 'missing' | 'unknown';
    note: string;
  };
  last_sync: {
    run_id: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    message: string | null;
  } | null;
  ssc_close_href: string;
  month_end_checklist_href: string;
  contract_version: typeof PHASE70_IES_CONTRACT_VERSION;
  money_auto_approve: false;
  ies_write_executed: false;
  ies_system_of_record: true;
};

function emptyRow(entityId: string): IesEntityFinanceRow {
  return {
    entity_id: entityId,
    company_name: entityDisplayName(entityId),
    realm_id: null,
    ies_company_name: null,
    mapped: false,
    feed_status: 'missing',
    cash_on_hand: null,
    ar_balance: null,
    ap_balance: null,
    burn_rate_monthly: null,
    open_invoices: null,
    overdue_invoices: null,
    open_invoice_balance: null,
    coa_account_count: null,
    coa_by_type: {},
    as_of: null,
    todo: 'Connect IES company and map realm to this entity',
  };
}

export async function getIesFinanceReport(input?: {
  entityId?: string | null;
}): Promise<IesFinanceReport> {
  const cfg = getIesConfig();
  const connections = await listIesConnections();
  const focus = input?.entityId?.trim() || null;

  const companies: IesEntityFinanceRow[] = IES_OPERATING_ENTITIES.map((id) =>
    emptyRow(id),
  );

  try {
    const sb = await createPersistClient();
    const { data: maps } = await sb
      .from('os_ies_entity_map')
      .select('entity_id, realm_id, ies_company_name, is_active');

    for (const m of maps ?? []) {
      const id = String(m.entity_id);
      let row = companies.find((c) => c.entity_id === id);
      if (!row) {
        row = emptyRow(id);
        companies.push(row);
      }
      row.realm_id = (m.realm_id as string) ?? null;
      row.ies_company_name = (m.ies_company_name as string) ?? null;
      row.mapped = Boolean(m.realm_id) && m.is_active !== false;
      if (row.mapped) row.todo = null;
    }

    for (const row of companies) {
      if (!row.entity_id) continue;
      const { data: feed } = await sb
        .from('os_ies_finance_feed')
        .select(
          'as_of, cash_on_hand, ar_balance, ap_balance, burn_rate_monthly, detail, created_at',
        )
        .eq('entity_id', row.entity_id)
        .order('as_of', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (feed) {
        const detail = (feed.detail ?? {}) as Record<string, unknown>;
        const isStub = detail.stub === true;
        row.as_of = (feed.as_of as string) ?? null;
        row.cash_on_hand =
          feed.cash_on_hand != null ? Number(feed.cash_on_hand) : null;
        row.ar_balance =
          feed.ar_balance != null ? Number(feed.ar_balance) : null;
        row.ap_balance =
          feed.ap_balance != null ? Number(feed.ap_balance) : null;
        row.burn_rate_monthly =
          feed.burn_rate_monthly != null
            ? Number(feed.burn_rate_monthly)
            : null;
        row.feed_status = isStub
          ? 'missing'
          : row.cash_on_hand == null && row.ar_balance == null
            ? 'partial'
            : 'ok';
        if (isStub) {
          row.todo =
            'IES feed stub present — run sync after OAuth connect';
        }
      }

      const { data: inv } = await sb
        .from('os_ies_invoice_signals')
        .select(
          'open_invoice_count, overdue_count, open_balance_total, as_of',
        )
        .eq('entity_id', row.entity_id)
        .order('as_of', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (inv) {
        row.open_invoices = Number(inv.open_invoice_count ?? 0);
        row.overdue_invoices = Number(inv.overdue_count ?? 0);
        row.open_invoice_balance =
          inv.open_balance_total != null
            ? Number(inv.open_balance_total)
            : null;
      }

      const { data: coa } = await sb
        .from('os_ies_coa_snapshots')
        .select('account_count, by_type, as_of')
        .eq('entity_id', row.entity_id)
        .order('as_of', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (coa) {
        row.coa_account_count = Number(coa.account_count ?? 0);
        row.coa_by_type =
          (coa.by_type as Record<string, number>) ?? {};
      }
    }
  } catch {
    /* fail soft — empty companies already seeded */
  }

  let filtered = companies;
  if (focus) {
    filtered = companies.filter((c) => c.entity_id === focus);
  }

  const live = companies.filter((c) => c.feed_status === 'ok' || c.feed_status === 'partial');
  const sum = (pick: (r: IesEntityFinanceRow) => number | null) => {
    let t = 0;
    let any = false;
    for (const r of live) {
      const v = pick(r);
      if (v != null) {
        t += v;
        any = true;
      }
    }
    return any ? t : null;
  };

  let lastSync: IesFinanceReport['last_sync'] = null;
  try {
    const sb = await createPersistClient();
    const { data } = await sb
      .from('os_ies_sync_runs')
      .select('run_id, status, started_at, finished_at, detail')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      const detail = (data.detail ?? {}) as Record<string, unknown>;
      lastSync = {
        run_id: String(data.run_id),
        status: String(data.status),
        started_at: String(data.started_at),
        finished_at: (data.finished_at as string) ?? null,
        message: typeof detail.message === 'string' ? detail.message : null,
      };
    }
  } catch {
    /* ignore */
  }

  const entityQs = focus ? `?entity=${encodeURIComponent(focus)}` : '';

  return {
    configured: cfg.configured,
    missing_secrets: cfg.missing,
    secrets_doc: IES_SECRETS_DOC,
    connections,
    companies: filtered,
    consolidated: {
      cash_on_hand: sum((r) => r.cash_on_hand),
      ar_balance: sum((r) => r.ar_balance),
      ap_balance: sum((r) => r.ap_balance),
      open_invoices: sum((r) => r.open_invoices),
      overdue_invoices: sum((r) => r.overdue_invoices),
      as_of: live[0]?.as_of ?? null,
      feed_status:
        live.length === 0
          ? 'missing'
          : live.every((r) => r.feed_status === 'ok')
            ? 'ok'
            : 'partial',
      note: 'Consolidated sum of mapped operating entities — eliminations not applied',
    },
    last_sync: lastSync,
    ssc_close_href: `/shared-services/checklists${entityQs}`,
    month_end_checklist_href: `/shared-services/finance${entityQs}#month-end-close`,
    contract_version: PHASE70_IES_CONTRACT_VERSION,
    money_auto_approve: false,
    ies_write_executed: false,
    ies_system_of_record: true,
  };
}

export async function mapEntityToRealm(input: {
  entity_id: string;
  realm_id: string;
  ies_company_name?: string | null;
  actor_id?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^ENT-[A-Z0-9-]{1,32}$/.test(input.entity_id)) {
    return { ok: false, error: 'Invalid entity_id' };
  }
  if (!/^[0-9A-Za-z-]{1,64}$/.test(input.realm_id)) {
    return { ok: false, error: 'Invalid realm_id' };
  }
  try {
    const sb = await createPersistClient();
    const now = new Date().toISOString();
    const { error } = await sb.from('os_ies_entity_map').upsert(
      {
        entity_id: input.entity_id,
        realm_id: input.realm_id,
        ies_company_name: input.ies_company_name ?? null,
        is_active: true,
        mapped_at: now,
        mapped_by: input.actor_id ?? null,
        updated_at: now,
      },
      { onConflict: 'entity_id' },
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Map failed',
    };
  }
}
