/**
 * IES → Tage read sync. Writes feed/COA/invoice snapshots only.
 * Never posts to IES.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { getIesConfig, PHASE70_IES_CONTRACT_VERSION } from '@/lib/ies/config';
import { loadIesAccessToken } from '@/lib/ies/oauth';
import {
  fetchCompanyInfo,
  pullBalanceSnapshot,
  pullChartOfAccounts,
  pullInvoiceSignals,
} from '@/lib/ies/qbo-client';

export type IesSyncEntityResult = {
  entity_id: string;
  realm_id: string;
  ok: boolean;
  partial: boolean;
  error?: string;
  cash_on_hand?: number | null;
  ar_balance?: number | null;
  ap_balance?: number | null;
  revenue_mtd?: number | null;
  expenses_mtd?: number | null;
  net_income_mtd?: number | null;
  data_gaps?: string[];
};

export type IesSyncRunResult = {
  ok: boolean;
  status: 'ok' | 'partial' | 'failed' | 'skipped';
  run_id: string | null;
  attempted: number;
  succeeded: number;
  failed: number;
  results: IesSyncEntityResult[];
  message: string;
  contract_version: typeof PHASE70_IES_CONTRACT_VERSION;
  money_auto_approve: false;
  ies_write_executed: false;
};

async function listMappedEntities(): Promise<
  Array<{ entity_id: string; realm_id: string; ies_company_name: string | null }>
> {
  try {
    const sb = await createPersistClient();
    const { data } = await sb
      .from('os_ies_entity_map')
      .select('entity_id, realm_id, ies_company_name')
      .eq('is_active', true)
      .not('realm_id', 'is', null);
    return (data ?? [])
      .filter((r) => r.realm_id)
      .map((r) => ({
        entity_id: String(r.entity_id),
        realm_id: String(r.realm_id),
        ies_company_name: (r.ies_company_name as string) ?? null,
      }));
  } catch {
    return [];
  }
}

export async function syncIesEntity(input: {
  entity_id: string;
  realm_id: string;
}): Promise<IesSyncEntityResult> {
  const token = await loadIesAccessToken(input.realm_id);
  if (!token.ok) {
    return {
      entity_id: input.entity_id,
      realm_id: input.realm_id,
      ok: false,
      partial: false,
      error: token.error,
    };
  }

  const env = token.environment;
  const notes: string[] = [];

  const company = await fetchCompanyInfo(input.realm_id, token.accessToken, env);
  if (company.ok && company.name) {
    try {
      const sb = await createPersistClient();
      await sb
        .from('os_ies_entity_map')
        .update({
          ies_company_name: company.name,
          updated_at: new Date().toISOString(),
        })
        .eq('entity_id', input.entity_id);
      await sb
        .from('os_ies_oauth_tokens')
        .update({
          company_name: company.name,
          updated_at: new Date().toISOString(),
        })
        .eq('realm_id', input.realm_id);
    } catch {
      /* ignore label update failures */
    }
  }

  const [coa, balances, invoices] = await Promise.all([
    pullChartOfAccounts(input.realm_id, token.accessToken, env),
    pullBalanceSnapshot(input.realm_id, token.accessToken, env),
    pullInvoiceSignals(input.realm_id, token.accessToken, env),
  ]);

  if (!coa.ok) notes.push(coa.error);
  if (!balances.ok) notes.push(balances.error);
  else notes.push(...balances.data.notes);
  if (!invoices.ok) notes.push(invoices.error);
  else notes.push(...invoices.data.notes);

  const asOf = new Date().toISOString().slice(0, 10);
  const burn =
    balances.ok && balances.data.expensesMtd != null
      ? Math.abs(balances.data.expensesMtd)
      : null;

  try {
    const sb = await createPersistClient();

    if (coa.ok) {
      const sample = coa.data.accounts.slice(0, 12).map((a) => ({
        id: a.id,
        name: a.name,
        type: a.accountType,
        active: a.active,
        balance: a.currentBalance,
      }));
      await sb.from('os_ies_coa_snapshots').insert({
        entity_id: input.entity_id,
        realm_id: input.realm_id,
        as_of: asOf,
        account_count: coa.data.accountCount,
        active_count: coa.data.activeCount,
        by_type: coa.data.byType,
        sample_accounts: sample,
        source_system: 'ies',
        money_auto_approve: false,
        detail: {
          phase: 'phase70',
          note: 'Read-only COA pull',
        },
      });
    }

    if (invoices.ok) {
      await sb.from('os_ies_invoice_signals').insert({
        entity_id: input.entity_id,
        realm_id: input.realm_id,
        as_of: asOf,
        open_invoice_count: invoices.data.openInvoiceCount,
        open_balance_total: invoices.data.openBalanceTotal,
        overdue_count: invoices.data.overdueCount,
        overdue_balance_total: invoices.data.overdueBalanceTotal,
        paid_mtd_count: invoices.data.paidMtdCount,
        paid_mtd_total: invoices.data.paidMtdTotal,
        money_auto_approve: false,
        detail: {
          phase: 'phase70',
          notes: invoices.data.notes.slice(0, 5),
        },
      });
    }

    const cash = balances.ok ? balances.data.cashOnHand : null;
    const ar = balances.ok ? balances.data.arBalance : null;
    const ap = balances.ok ? balances.data.apBalance : null;
    const periodStart = `${asOf.slice(0, 8)}01`;

    if (balances.ok) {
      const reportGaps = balances.data.notes.slice(0, 12);
      await sb.from('os_ies_financial_snapshots').insert([
        {
          entity_id: input.entity_id,
          realm_id: input.realm_id,
          report_type: 'profit_loss',
          period_start: periodStart,
          period_end: asOf,
          as_of: asOf,
          payload: {
            revenue: balances.data.revenueMtd,
            expenses: balances.data.expensesMtd,
            net_income: balances.data.netIncomeMtd,
          },
          data_gaps: reportGaps,
        },
        {
          entity_id: input.entity_id,
          realm_id: input.realm_id,
          report_type: 'balance_sheet',
          as_of: asOf,
          payload: {
            cash: balances.data.cashOnHand,
            accounts_receivable: balances.data.arBalance,
            accounts_payable: balances.data.apBalance,
          },
          data_gaps: reportGaps,
        },
      ]);
    }

    await sb.from('os_ies_finance_feed').insert({
      entity_id: input.entity_id,
      as_of: asOf,
      cash_on_hand: cash,
      ar_balance: ar,
      ap_balance: ap,
      burn_rate_monthly: burn,
      close_pct_complete: null,
      source_system: 'ies',
      detail: {
        phase: 'phase81',
        realm_id: input.realm_id,
        revenue_mtd: balances.ok ? balances.data.revenueMtd : null,
        expenses_mtd: balances.ok ? balances.data.expensesMtd : null,
        net_income_mtd: balances.ok ? balances.data.netIncomeMtd : null,
        invoice_open: invoices.ok ? invoices.data.openInvoiceCount : null,
        invoice_overdue: invoices.ok ? invoices.data.overdueCount : null,
        notes: notes.slice(0, 6),
        stub: false,
      },
    });

    await sb
      .from('os_ies_entity_map')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status:
          notes.length > 0 || !(coa.ok && balances.ok && invoices.ok)
            ? 'partial'
            : 'ok',
        data_gaps: notes.slice(0, 12),
        updated_at: new Date().toISOString(),
      })
      .eq('entity_id', input.entity_id);

    const ok = coa.ok || balances.ok || invoices.ok;
    return {
      entity_id: input.entity_id,
      realm_id: input.realm_id,
      ok,
      partial: notes.length > 0 || !(coa.ok && balances.ok && invoices.ok),
      error: ok ? undefined : notes.join('; ') || 'Sync failed',
      cash_on_hand: cash,
      ar_balance: ar,
      ap_balance: ap,
      revenue_mtd: balances.ok ? balances.data.revenueMtd : null,
      expenses_mtd: balances.ok ? balances.data.expensesMtd : null,
      net_income_mtd: balances.ok ? balances.data.netIncomeMtd : null,
      data_gaps: notes,
    };
  } catch (e) {
    return {
      entity_id: input.entity_id,
      realm_id: input.realm_id,
      ok: false,
      partial: false,
      error: e instanceof Error ? e.message : 'Persist sync failed',
    };
  }
}

async function writeConsolidatedFeed(
  results: IesSyncEntityResult[],
): Promise<void> {
  const okRows = results.filter((r) => r.ok);
  if (okRows.length === 0) return;
  const sum = (pick: (r: IesSyncEntityResult) => number | null | undefined) => {
    let total = 0;
    let any = false;
    for (const r of okRows) {
      const v = pick(r);
      if (v != null && !Number.isNaN(v)) {
        total += v;
        any = true;
      }
    }
    return any ? total : null;
  };
  try {
    const sb = await createPersistClient();
    await sb.from('os_ies_finance_feed').insert({
      entity_id: null,
      as_of: new Date().toISOString().slice(0, 10),
      cash_on_hand: sum((r) => r.cash_on_hand),
      ar_balance: sum((r) => r.ar_balance),
      ap_balance: sum((r) => r.ap_balance),
      burn_rate_monthly: null,
      close_pct_complete: null,
      source_system: 'ies',
      detail: {
        phase: 'phase70',
        consolidated: true,
        entity_ids: okRows.map((r) => r.entity_id),
        note: 'Sum of connected company feeds — no intercompany eliminations',
      },
    });
  } catch {
    /* fail soft */
  }
}

export async function runIesSync(input?: {
  trigger?: string;
  entity_id?: string | null;
}): Promise<IesSyncRunResult> {
  const cfg = getIesConfig();
  if (!cfg.syncEnabled) {
    return {
      ok: false,
      status: 'skipped',
      run_id: null,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      results: [],
      message: 'IES read sync disabled (set IES_SYNC_ENABLED=1 when ready)',
      contract_version: PHASE70_IES_CONTRACT_VERSION,
      money_auto_approve: false,
      ies_write_executed: false,
    };
  }
  if (!cfg.configured) {
    return {
      ok: false,
      status: 'skipped',
      run_id: null,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      results: [],
      message: `IES credentials missing: ${cfg.missing.join(', ')}`,
      contract_version: PHASE70_IES_CONTRACT_VERSION,
      money_auto_approve: false,
      ies_write_executed: false,
    };
  }

  let runId: string | null = null;
  try {
    const sb = await createPersistClient();
    const { data } = await sb
      .from('os_ies_sync_runs')
      .insert({
        status: 'running',
        trigger_source: (input?.trigger ?? 'manual').slice(0, 32),
        detail: { entity_filter: input?.entity_id ?? null },
      })
      .select('run_id')
      .maybeSingle();
    runId = data?.run_id ? String(data.run_id) : null;
  } catch {
    /* continue without run log */
  }

  let mapped = await listMappedEntities();
  if (input?.entity_id) {
    mapped = mapped.filter((m) => m.entity_id === input.entity_id);
  }

  if (mapped.length === 0) {
    const message =
      'No entity↔realm mappings with connected tokens. Connect IES and map companies.';
    if (runId) {
      try {
        const sb = await createPersistClient();
        await sb
          .from('os_ies_sync_runs')
          .update({
            status: 'skipped',
            finished_at: new Date().toISOString(),
            detail: { message },
          })
          .eq('run_id', runId);
      } catch {
        /* ignore */
      }
    }
    return {
      ok: false,
      status: 'skipped',
      run_id: runId,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      results: [],
      message,
      contract_version: PHASE70_IES_CONTRACT_VERSION,
      money_auto_approve: false,
      ies_write_executed: false,
    };
  }

  const results: IesSyncEntityResult[] = [];
  for (const m of mapped) {
    results.push(
      await syncIesEntity({ entity_id: m.entity_id, realm_id: m.realm_id }),
    );
  }

  await writeConsolidatedFeed(results);

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;
  const status =
    failed === 0 ? 'ok' : succeeded > 0 ? 'partial' : 'failed';

  if (runId) {
    try {
      const sb = await createPersistClient();
      await sb
        .from('os_ies_sync_runs')
        .update({
          status,
          finished_at: new Date().toISOString(),
          entities_attempted: results.length,
          entities_ok: succeeded,
          entities_failed: failed,
          detail: {
            results: results.map((r) => ({
              entity_id: r.entity_id,
              ok: r.ok,
              partial: r.partial,
              error: r.error ?? null,
            })),
          },
        })
        .eq('run_id', runId);
    } catch {
      /* ignore */
    }
  }

  return {
    ok: succeeded > 0,
    status,
    run_id: runId,
    attempted: results.length,
    succeeded,
    failed,
    results,
    message:
      status === 'ok'
        ? `Synced ${succeeded} IES companies`
        : status === 'partial'
          ? `Partial sync: ${succeeded} ok, ${failed} failed`
          : `Sync failed for ${failed} companies`,
    contract_version: PHASE70_IES_CONTRACT_VERSION,
    money_auto_approve: false,
    ies_write_executed: false,
  };
}
