/**
 * Read-only Intuit QBO Accounting client for IES books.
 * Fail-soft: returns partial/null on any API or parse error.
 */

import { iesApiBase, IES_MINOR_VERSION, type IesEnvironment } from '@/lib/ies/config';

export type IesAccountSummary = {
  id: string;
  name: string;
  accountType: string;
  accountSubType: string | null;
  active: boolean;
  currentBalance: number | null;
};

export type IesCoaPull = {
  accounts: IesAccountSummary[];
  byType: Record<string, number>;
  accountCount: number;
  activeCount: number;
};

export type IesBalancePull = {
  cashOnHand: number | null;
  arBalance: number | null;
  apBalance: number | null;
  revenueMtd: number | null;
  expensesMtd: number | null;
  netIncomeMtd: number | null;
  partial: boolean;
  notes: string[];
};

export type IesInvoicePull = {
  openInvoiceCount: number;
  openBalanceTotal: number;
  overdueCount: number;
  overdueBalanceTotal: number;
  paidMtdCount: number;
  paidMtdTotal: number;
  partial: boolean;
  notes: string[];
};

async function qboFetch(
  path: string,
  accessToken: string,
  environment: IesEnvironment,
): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
  const url = new URL(`${iesApiBase(environment)}${path}`);
  if (!url.searchParams.has('minorversion')) {
    url.searchParams.set('minorversion', IES_MINOR_VERSION);
  }
  try {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `QBO HTTP ${res.status}${text ? `: ${text.slice(0, 180)}` : ''}`,
      };
    }
    return { ok: true, json: await res.json() };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'QBO fetch failed',
    };
  }
}

export async function fetchCompanyInfo(
  realmId: string,
  accessToken: string,
  environment: IesEnvironment,
): Promise<{ ok: true; name: string | null } | { ok: false; error: string }> {
  const res = await qboFetch(
    `/v3/company/${realmId}/companyinfo/${realmId}`,
    accessToken,
    environment,
  );
  if (!res.ok) return res;
  const root = res.json as {
    CompanyInfo?: { CompanyName?: string; LegalName?: string };
  };
  const name =
    root.CompanyInfo?.CompanyName ||
    root.CompanyInfo?.LegalName ||
    null;
  return { ok: true, name };
}

export async function pullChartOfAccounts(
  realmId: string,
  accessToken: string,
  environment: IesEnvironment,
): Promise<{ ok: true; data: IesCoaPull } | { ok: false; error: string }> {
  const query = encodeURIComponent(
    "select * from Account maxresults 1000",
  );
  const res = await qboFetch(
    `/v3/company/${realmId}/query?query=${query}`,
    accessToken,
    environment,
  );
  if (!res.ok) return res;
  const root = res.json as {
    QueryResponse?: { Account?: Array<Record<string, unknown>> };
  };
  const rows = root.QueryResponse?.Account ?? [];
  const accounts: IesAccountSummary[] = rows.map((a) => ({
    id: String(a.Id ?? ''),
    name: String(a.Name ?? 'Unnamed'),
    accountType: String(a.AccountType ?? 'Other'),
    accountSubType: a.AccountSubType ? String(a.AccountSubType) : null,
    active: a.Active !== false,
    currentBalance:
      typeof a.CurrentBalance === 'number'
        ? a.CurrentBalance
        : a.CurrentBalance != null
          ? Number(a.CurrentBalance)
          : null,
  }));
  const byType: Record<string, number> = {};
  let activeCount = 0;
  for (const a of accounts) {
    byType[a.accountType] = (byType[a.accountType] ?? 0) + 1;
    if (a.active) activeCount += 1;
  }
  return {
    ok: true,
    data: {
      accounts,
      byType,
      accountCount: accounts.length,
      activeCount,
    },
  };
}

function walkReportRows(
  rows: unknown,
  visit: (label: string, value: number | null) => void,
): void {
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as {
      Header?: { ColData?: Array<{ value?: string }> };
      Summary?: { ColData?: Array<{ value?: string }> };
      ColData?: Array<{ value?: string }>;
      Rows?: { Row?: unknown };
    };
    const label =
      r.ColData?.[0]?.value ||
      r.Header?.ColData?.[0]?.value ||
      r.Summary?.ColData?.[0]?.value ||
      '';
    const rawVal =
      r.ColData?.[1]?.value ||
      r.Summary?.ColData?.[1]?.value ||
      null;
    const num =
      rawVal != null && rawVal !== '' && !Number.isNaN(Number(rawVal))
        ? Number(rawVal)
        : null;
    if (label) visit(label, num);
    if (r.Rows?.Row) walkReportRows(r.Rows.Row, visit);
  }
}

function matchAmount(
  label: string,
  value: number | null,
  patterns: RegExp[],
): number | null {
  if (value == null) return null;
  const l = label.toLowerCase();
  return patterns.some((p) => p.test(l)) ? value : null;
}

export async function pullBalanceSnapshot(
  realmId: string,
  accessToken: string,
  environment: IesEnvironment,
): Promise<{ ok: true; data: IesBalancePull } | { ok: false; error: string }> {
  const notes: string[] = [];
  let cashOnHand: number | null = null;
  let arBalance: number | null = null;
  let apBalance: number | null = null;
  let revenueMtd: number | null = null;
  let expensesMtd: number | null = null;
  let netIncomeMtd: number | null = null;

  const bs = await qboFetch(
    `/v3/company/${realmId}/reports/BalanceSheet`,
    accessToken,
    environment,
  );
  if (bs.ok) {
    const root = bs.json as { Rows?: { Row?: unknown } };
    walkReportRows(root.Rows?.Row, (label, value) => {
      const cash = matchAmount(label, value, [
        /total bank/,
        /cash and cash equivalents/,
        /^bank accounts$/,
        /total checking/,
      ]);
      if (cash != null) cashOnHand = cash;
      const ar = matchAmount(label, value, [
        /accounts receivable/,
        /a\/r/,
        /total accounts receivable/,
      ]);
      if (ar != null) arBalance = ar;
      const ap = matchAmount(label, value, [
        /accounts payable/,
        /a\/p/,
        /total accounts payable/,
      ]);
      if (ap != null) apBalance = ap;
    });
  } else {
    notes.push(`BalanceSheet: ${bs.error}`);
  }

  const pl = await qboFetch(
    `/v3/company/${realmId}/reports/ProfitAndLoss`,
    accessToken,
    environment,
  );
  if (pl.ok) {
    const root = pl.json as { Rows?: { Row?: unknown } };
    walkReportRows(root.Rows?.Row, (label, value) => {
      const rev = matchAmount(label, value, [
        /^total income$/,
        /^income$/,
        /total revenue/,
      ]);
      if (rev != null) revenueMtd = rev;
      const exp = matchAmount(label, value, [
        /^total expenses$/,
        /^expenses$/,
        /total expense/,
      ]);
      if (exp != null) expensesMtd = exp;
      const ni = matchAmount(label, value, [
        /net income/,
        /net operating income/,
      ]);
      if (ni != null) netIncomeMtd = ni;
    });
  } else {
    notes.push(`ProfitAndLoss: ${pl.error}`);
  }

  // Fallback cash from Bank accounts on COA if BS miss
  if (cashOnHand == null) {
    const coa = await pullChartOfAccounts(realmId, accessToken, environment);
    if (coa.ok) {
      const bankSum = coa.data.accounts
        .filter((a) => a.active && /bank|cash/i.test(a.accountType))
        .reduce((s, a) => s + (a.currentBalance ?? 0), 0);
      if (bankSum !== 0 || coa.data.accounts.some((a) => /bank/i.test(a.accountType))) {
        cashOnHand = bankSum;
        notes.push('Cash derived from Account.CurrentBalance bank types');
      }
    }
  }

  return {
    ok: true,
    data: {
      cashOnHand,
      arBalance,
      apBalance,
      revenueMtd,
      expensesMtd,
      netIncomeMtd,
      partial: notes.length > 0 || cashOnHand == null,
      notes,
    },
  };
}

export async function pullInvoiceSignals(
  realmId: string,
  accessToken: string,
  environment: IesEnvironment,
): Promise<{ ok: true; data: IesInvoicePull } | { ok: false; error: string }> {
  const notes: string[] = [];
  const openQuery = encodeURIComponent(
    "select * from Invoice where Balance != '0' maxresults 500",
  );
  const openRes = await qboFetch(
    `/v3/company/${realmId}/query?query=${openQuery}`,
    accessToken,
    environment,
  );

  let openInvoiceCount = 0;
  let openBalanceTotal = 0;
  let overdueCount = 0;
  let overdueBalanceTotal = 0;
  const today = new Date().toISOString().slice(0, 10);

  if (openRes.ok) {
    const root = openRes.json as {
      QueryResponse?: { Invoice?: Array<Record<string, unknown>> };
    };
    const invoices = root.QueryResponse?.Invoice ?? [];
    openInvoiceCount = invoices.length;
    for (const inv of invoices) {
      const bal = Number(inv.Balance ?? 0) || 0;
      openBalanceTotal += bal;
      const due = inv.DueDate ? String(inv.DueDate) : null;
      if (due && due < today && bal > 0) {
        overdueCount += 1;
        overdueBalanceTotal += bal;
      }
    }
  } else {
    notes.push(`Open invoices: ${openRes.error}`);
  }

  // Paid MTD — best-effort Payment query
  const monthStart = `${today.slice(0, 8)}01`;
  const paidQuery = encodeURIComponent(
    `select * from Payment where TxnDate >= '${monthStart}' maxresults 500`,
  );
  let paidMtdCount = 0;
  let paidMtdTotal = 0;
  const paidRes = await qboFetch(
    `/v3/company/${realmId}/query?query=${paidQuery}`,
    accessToken,
    environment,
  );
  if (paidRes.ok) {
    const root = paidRes.json as {
      QueryResponse?: { Payment?: Array<Record<string, unknown>> };
    };
    const payments = root.QueryResponse?.Payment ?? [];
    paidMtdCount = payments.length;
    for (const p of payments) {
      paidMtdTotal += Number(p.TotalAmt ?? 0) || 0;
    }
  } else {
    notes.push(`Payments MTD: ${paidRes.error}`);
  }

  return {
    ok: true,
    data: {
      openInvoiceCount,
      openBalanceTotal,
      overdueCount,
      overdueBalanceTotal,
      paidMtdCount,
      paidMtdTotal,
      partial: notes.length > 0,
      notes,
    },
  };
}
