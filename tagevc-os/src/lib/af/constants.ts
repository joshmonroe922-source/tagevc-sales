/** Health enums — Spec handoff non-negotiable. */
export const HEALTH_STATUSES = [
  'On Track',
  'Watch',
  'At Risk',
  'Critical',
] as const;

export const COMPANY_ENTITY_CODES = ['TVC', 'R619', 'SHR', 'INDA'] as const;

export const ENTITY_DISPLAY: Record<string, string> = {
  TVC: 'Tage VC',
  R619: 'Recruit 619',
  SHR: 'Signent HR',
  INDA: 'Instant NDA',
  PERS: 'Personal',
  CONSOL: 'Consolidated',
};

/** Canonical legal names — never "619 Recruiting". */
export const CANONICAL_ENTITY_NAMES = {
  TVC: 'Tage Venture Capital',
  R619: 'Recruit 619',
  SHR: 'Signent HR',
  INDA: 'Instant NDA',
} as const;

export const OPERATING_GL = '1000';
export const INVESTMENTS_GL = '1010';
export const SAVINGS_GL = '1040';
export const UNDEPOSITED_GL = '1090';
export const AR_GL = '1100';
export const AP_GL = '2000';
export const COMMISSION_LIABILITY_GL = '2250';
export const DUE_TO_PARENT_GL = '2450';
export const MGMT_FEE_EXPENSE_GL = '6950';
export const MGMT_FEE_INCOME_GL = '4000';

export const CASH_GLS_BY_ENTITY: Record<string, string[]> = {
  TVC: [OPERATING_GL, INVESTMENTS_GL, UNDEPOSITED_GL],
  R619: [OPERATING_GL, SAVINGS_GL, UNDEPOSITED_GL],
  SHR: [OPERATING_GL, SAVINGS_GL, UNDEPOSITED_GL],
  INDA: [OPERATING_GL, SAVINGS_GL, UNDEPOSITED_GL],
  PERS: ['1000', '1010', '1020'],
};

export const AF_BASE = '/shared-services/af' as const;

export const ACCOUNTING_MODULES = [
  {
    id: 'gl',
    label: 'General Ledger',
    path: `${AF_BASE}/accounting/gl`,
    description: 'Trial balance · journals · dimensions',
  },
  {
    id: 'invoices',
    label: 'Invoices (AR)',
    path: `${AF_BASE}/accounting/invoices`,
    description: 'Create · send · attachments · paid waterfall',
  },
  {
    id: 'bills',
    label: 'Bills (AP)',
    path: `${AF_BASE}/accounting/bills`,
    description: 'Approvals · pay · auto-match',
  },
  {
    id: 'banks',
    label: 'Banks & Cards',
    path: `${AF_BASE}/accounting/banks`,
    description: 'Operating · savings · feeds · reconcile',
  },
  {
    id: 'commissions',
    label: 'Commissions',
    path: `${AF_BASE}/accounting/commissions`,
    description: 'Protected liability 2250 · payouts',
  },
  {
    id: 'ic',
    label: 'Intercompany',
    path: `${AF_BASE}/accounting/ic`,
    description: 'Due From/To · mgmt fee · eliminations',
  },
  {
    id: 'close',
    label: 'Close',
    path: `${AF_BASE}/accounting/close`,
    description: 'Continuous close · period lock',
  },
  {
    id: 'attachments',
    label: 'Invoice Attachments',
    path: `${AF_BASE}/accounting/settings/invoice-attachments`,
    description: 'Entity Wire + I-9 defaults',
  },
] as const;

export const FINANCE_MODULES = [
  {
    id: 'budgets',
    label: 'Budgets',
    path: `${AF_BASE}/finance/budgets`,
    description: 'Annual + rolling vs actual',
  },
  {
    id: 'forecasts',
    label: 'Forecasts',
    path: `${AF_BASE}/finance/forecasts`,
    description: 'AI horizons 3m–10y',
  },
  {
    id: 'cash',
    label: 'Cash Forecast',
    path: `${AF_BASE}/finance/cash`,
    description: '13-week + bank balances',
  },
  {
    id: 'loans',
    label: 'Loans',
    path: `${AF_BASE}/finance/loans`,
    description: 'Amortization · extra-pay simulator',
  },
  {
    id: 'hiring',
    label: 'Hiring Estimator',
    path: `${AF_BASE}/finance/hiring`,
    description: 'Dept waterfall affordability',
  },
  {
    id: 'buckets',
    label: 'Revenue Buckets',
    path: `${AF_BASE}/finance/buckets`,
    description: 'DIR · SALES · MKT · GA · TECH · COMM · PROFIT',
  },
  {
    id: 'net-worth',
    label: 'Company Net Worth',
    path: `${AF_BASE}/finance/net-worth`,
    description: 'Entity + consolidated (no card UI)',
  },
  {
    id: 'reports',
    label: 'Reports & KPIs',
    path: `${AF_BASE}/finance/reports`,
    description: 'P&L · BS · CF · aging · time filters',
  },
] as const;

export const PERSONAL_FINANCE_MODULES = [
  {
    id: 'home',
    label: 'Overview',
    path: '/personal/finance',
    description: 'P&L · accounts · net worth snapshot',
  },
  {
    id: 'accounts',
    label: 'Accounts',
    path: '/personal/finance/accounts',
    description: 'Banks · brokerage · feeds',
  },
  {
    id: 'cards',
    label: 'Credit Cards',
    path: '/personal/finance/cards',
    description: 'Balances · utilization · pay',
  },
  {
    id: 'bills',
    label: 'Bills',
    path: '/personal/finance/bills',
    description: 'Vendors · recurring · pay',
  },
  {
    id: 'invoices',
    label: 'Income Invoices',
    path: '/personal/finance/invoices',
    description: 'Personal AR-lite',
  },
  {
    id: 'family',
    label: 'Family',
    path: '/personal/finance/family',
    description: 'MD — Personal Family classes',
  },
  {
    id: 'net-worth',
    label: 'Net Worth',
    path: '/personal/finance/net-worth',
    description: 'Full asset stack − liability total',
  },
  {
    id: 'coa',
    label: 'Chart of Accounts',
    path: '/personal/finance/coa',
    description: 'CoA — Personal',
  },
  {
    id: 'reports',
    label: 'Reports',
    path: '/personal/finance/reports',
    description: 'P&L · BS by family class',
  },
  {
    id: 'setup',
    label: 'Setup',
    path: '/personal/finance/setup',
    description: 'Personal go-live wizard',
  },
] as const;
