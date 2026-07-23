/**
 * Phase 55 — Finance Control Plane (IES orchestration) contracts + stubs.
 * IES remains system of record; Tage orchestrates/observes only.
 */

export const PHASE55_FINANCE_CONTRACT_VERSION = 'phase55-v1' as const;
export const PHASE55_ENTITY_FILTER_HINT = 'ENT-R619';

export type FinanceFeedStatus = 'ok' | 'partial' | 'missing' | 'unknown';

export type FinanceCloseStatus =
  | 'open'
  | 'in_progress'
  | 'blocked'
  | 'done'
  | 'waived';

export type FinanceWritebackStatus =
  | 'pending'
  | 'rejected'
  | 'dual_approved'
  | 'blocked'
  | 'superseded'
  | 'duplicate_actor_decision';

export type FinanceChecklistItem = {
  event_id?: string;
  entity_id: string | null;
  close_kind: 'month_end' | 'year_end' | string;
  period_key: string;
  item_key: string;
  item_label: string;
  status: FinanceCloseStatus | string;
  created_at: string;
};

export type FinanceAnomaly = {
  anomaly_id?: string;
  entity_id: string | null;
  anomaly_kind: string;
  severity: string;
  title: string;
  created_at: string;
};

export type FinanceWritebackProposal = {
  proposal_id: string;
  entity_id: string | null;
  action_kind: string;
  summary: string;
  proposed_by: string;
  status: FinanceWritebackStatus | string;
  created_at: string;
};

export type FinanceSubsidiaryVisibility = {
  entity_id: string;
  name: string;
  priority: number;
  feed_status: FinanceFeedStatus | string;
  has_data: boolean;
  todo: string | null;
};

export type FinanceControlPlanePhase55Report = {
  entity_id: string | null;
  cash_on_hand: number | null;
  ar_balance: number | null;
  ap_balance: number | null;
  burn_rate_monthly: number | null;
  close_pct_complete: number | null;
  open_anomaly_count: number;
  pending_writeback_count: number;
  feed_status: FinanceFeedStatus;
  snapshot_id: string | null;
  captured_at: string | null;
  checklist: FinanceChecklistItem[];
  anomalies: FinanceAnomaly[];
  writeback_proposals: FinanceWritebackProposal[];
  recent_alerts: Array<Record<string, unknown>>;
  subsidiaries: FinanceSubsidiaryVisibility[];
  entity_filter_hint: string;
  todo: string;
  money_auto_approve: false;
  ies_write_executed: false;
  ies_system_of_record: true;
  contract_version: typeof PHASE55_FINANCE_CONTRACT_VERSION;
};

const DEFAULT_SUBSIDIARIES: FinanceSubsidiaryVisibility[] = [
  {
    entity_id: 'ENT-R619',
    name: 'Recruit 619',
    priority: 1,
    feed_status: 'missing',
    has_data: false,
    // TODO: wire IES feed for Recruit financial KPIs
    todo: 'IES feed pending — Recruit KPIs are orchestration stubs',
  },
  {
    entity_id: 'ENT-INDA',
    name: 'Instant NDA',
    priority: 2,
    feed_status: 'missing',
    has_data: false,
    // TODO: show ENT-INDA financials when IES/entity evidence exists
    todo: 'TODO: show ENT-INDA financials when IES/entity evidence exists',
  },
];

export function emptyFinanceControlPlanePhase55Report(
  entityId: string | null = null,
): FinanceControlPlanePhase55Report {
  return {
    entity_id: entityId,
    cash_on_hand: null,
    ar_balance: null,
    ap_balance: null,
    burn_rate_monthly: null,
    close_pct_complete: null,
    open_anomaly_count: 0,
    pending_writeback_count: 0,
    feed_status: 'missing',
    snapshot_id: null,
    captured_at: null,
    checklist: [],
    anomalies: [],
    writeback_proposals: [],
    recent_alerts: [],
    subsidiaries: DEFAULT_SUBSIDIARIES,
    entity_filter_hint: PHASE55_ENTITY_FILTER_HINT,
    // TODO: Refresh board; wire IES feed when available.
    todo: 'Refresh finance board; wire IES feed when available',
    money_auto_approve: false,
    ies_write_executed: false,
    ies_system_of_record: true,
    contract_version: PHASE55_FINANCE_CONTRACT_VERSION,
  };
}

export function formatFinanceMetric(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

export function closeStatusLabel(status: string): string {
  if (status === 'in_progress') return 'In progress';
  if (status === 'blocked') return 'Blocked';
  if (status === 'done') return 'Done';
  if (status === 'waived') return 'Waived';
  return 'Open';
}
