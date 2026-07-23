/**
 * Phase 60 — Portfolio Operating Cadence contracts + stubs.
 * Weekly Visionary/COO tools: health board, risks/milestones, review packets,
 * handoff completeness, subsidiary linkage (ENT-R619 first; ENT-INDA when present).
 */

export const PHASE60_PORTFOLIO_CONTRACT_VERSION = 'phase60-v1' as const;
export const PHASE60_ENTITY_FILTER_HINT = 'ENT-R619';

export type PortfolioBoardStatus = 'ok' | 'partial' | 'missing' | 'unknown';

export type RiskMilestoneKind = 'risk' | 'milestone' | 'both';

export type RiskMilestoneStatus =
  | 'open'
  | 'watch'
  | 'mitigating'
  | 'done'
  | 'slipped';

export type ReviewPacketKind =
  | 'weekly_ops'
  | 'monthly_board'
  | 'ad_hoc'
  | 'subsidiary_deep_dive';

export type ReviewPacketStatus =
  | 'draft'
  | 'partial'
  | 'ready'
  | 'delivered'
  | 'stale';

export type RiskMilestoneEvent = {
  event_id: string;
  entity_id: string | null;
  portfolio_id: string | null;
  event_kind: RiskMilestoneKind | string;
  title: string;
  status: RiskMilestoneStatus | string;
  severity: string;
  due_on: string | null;
  created_at: string;
};

export type ReviewPacketEvent = {
  event_id: string;
  entity_id: string | null;
  portfolio_id: string | null;
  packet_kind: ReviewPacketKind | string;
  title: string;
  period_key: string;
  completeness_status: ReviewPacketStatus | string;
  created_at: string;
};

export type SubsidiaryPortfolioLink = {
  entity_id: string;
  name: string;
  priority: number;
  link_status: PortfolioBoardStatus | string;
  portfolio_id: string | null;
  has_data: boolean;
  todo: string | null;
  created_at: string | null;
};

export type PortfolioOperatingCadencePhase60Report = {
  entity_id: string | null;
  company_count: number;
  on_track_count: number;
  watch_count: number;
  at_risk_count: number;
  critical_count: number;
  attention_required: number;
  missing_risk_count: number;
  missing_milestone_count: number;
  board_status: PortfolioBoardStatus;
  handoff_total: number;
  handoff_complete: number;
  handoff_open: number;
  handoff_incomplete: number;
  linked_to_portfolio: number;
  handoff_completeness_pct: number | null;
  handoff_board_status: PortfolioBoardStatus | string;
  snapshot_id: string | null;
  captured_at: string | null;
  risks_milestones: RiskMilestoneEvent[];
  review_packets: ReviewPacketEvent[];
  subsidiaries: SubsidiaryPortfolioLink[];
  recent_alerts: Array<Record<string, unknown>>;
  entity_filter_hint: string;
  todo: string;
  weekly_cadence: true;
  contract_version: typeof PHASE60_PORTFOLIO_CONTRACT_VERSION;
};

const DEFAULT_SUBSIDIARIES: SubsidiaryPortfolioLink[] = [
  {
    entity_id: 'ENT-R619',
    name: 'Recruit 619',
    priority: 1,
    link_status: 'missing',
    portfolio_id: null,
    has_data: false,
    // TODO: ensure ENT-R619 portfolio company row + weekly cadence
    todo: 'TODO: ensure ENT-R619 portfolio company row + weekly cadence',
    created_at: null,
  },
  {
    entity_id: 'ENT-INDA',
    name: 'Instant NDA',
    priority: 2,
    link_status: 'missing',
    portfolio_id: null,
    has_data: false,
    // TODO: show ENT-INDA portfolio cadence when portfolio evidence exists
    todo: 'TODO: show ENT-INDA portfolio cadence when portfolio evidence exists',
    created_at: null,
  },
];

export function emptyPortfolioOperatingCadencePhase60Report(
  entityId: string | null = null,
): PortfolioOperatingCadencePhase60Report {
  return {
    entity_id: entityId,
    company_count: 0,
    on_track_count: 0,
    watch_count: 0,
    at_risk_count: 0,
    critical_count: 0,
    attention_required: 0,
    missing_risk_count: 0,
    missing_milestone_count: 0,
    board_status: 'missing',
    handoff_total: 0,
    handoff_complete: 0,
    handoff_open: 0,
    handoff_incomplete: 0,
    linked_to_portfolio: 0,
    handoff_completeness_pct: null,
    handoff_board_status: 'missing',
    snapshot_id: null,
    captured_at: null,
    risks_milestones: [],
    review_packets: [],
    subsidiaries: DEFAULT_SUBSIDIARIES,
    recent_alerts: [],
    entity_filter_hint: PHASE60_ENTITY_FILTER_HINT,
    // TODO: Refresh board; track risks/milestones; publish weekly packets.
    todo: 'Refresh portfolio operating cadence board; track risks/milestones; publish weekly review packets for ENT-R619',
    weekly_cadence: true,
    contract_version: PHASE60_PORTFOLIO_CONTRACT_VERSION,
  };
}

export function boardStatusLabel(status: string): string {
  if (status === 'ok') return 'OK';
  if (status === 'partial') return 'Partial';
  if (status === 'missing') return 'Missing';
  return 'Unknown';
}

export function formatCompletenessPct(
  value: number | null | undefined,
): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value}%`;
}

export function riskMilestoneLabel(kind: string): string {
  if (kind === 'milestone') return 'Milestone';
  if (kind === 'both') return 'Risk + milestone';
  return 'Risk';
}

export function packetKindLabel(kind: string): string {
  if (kind === 'monthly_board') return 'Monthly board';
  if (kind === 'ad_hoc') return 'Ad hoc';
  if (kind === 'subsidiary_deep_dive') return 'Subsidiary deep-dive';
  return 'Weekly ops';
}
