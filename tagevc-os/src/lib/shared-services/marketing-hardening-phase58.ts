/**
 * Phase 58 — Marketing Production Hardening contracts + stubs.
 * Money-impacting publish: propose + dual-approve only; never auto-approve money.
 * Recruit acquisition (job boards / careers) fail-soft stubs for ENT-R619.
 */

export const PHASE58_MARKETING_CONTRACT_VERSION = 'phase58-v1' as const;
export const PHASE58_ENTITY_FILTER_HINT = 'ENT-R619';

export type MarketingBoardStatus = 'ok' | 'partial' | 'missing' | 'unknown';

export type PublishActionKind =
  | 'paid_publish'
  | 'budget_change'
  | 'campaign_go_live'
  | 'brand_voice_override'
  | 'other_money_impact';

export type PublishProposalStatus =
  | 'pending'
  | 'rejected'
  | 'dual_approved'
  | 'blocked'
  | 'superseded'
  | 'duplicate_actor_decision';

export type PublishProposal = {
  proposal_id: string;
  entity_id: string | null;
  action_kind: PublishActionKind | string;
  summary: string;
  proposed_by: string;
  status: PublishProposalStatus | string;
  created_at: string;
};

export type RecruitAcquisitionEvent = {
  event_id?: string;
  entity_id: string;
  source_kind: string;
  applications: number;
  clicks: number;
  spend_observe: number | null;
  feed_status: MarketingBoardStatus | string;
  created_at: string;
  todo: string | null;
};

export type MarketingHardeningPhase58Report = {
  entity_id: string | null;
  in_review_count: number;
  overdue_count: number;
  due_soon_count: number;
  approved_count: number;
  sla_reliability_pct: number | null;
  board_status: MarketingBoardStatus;
  publishing_control_status: MarketingBoardStatus | string;
  brand_voice_status: MarketingBoardStatus | string;
  performance_status: MarketingBoardStatus | string;
  pending_jobs: number;
  failed_jobs: number;
  posted_jobs: number;
  voices_configured: number;
  content_without_voice: number;
  active_campaigns: number;
  paid_campaigns: number;
  organic_campaigns: number;
  pending_publish_proposals: number;
  recruit_feed_status: MarketingBoardStatus | string;
  recruit_applications: number;
  recruit_clicks: number;
  snapshot_id: string | null;
  captured_at: string | null;
  publish_proposals: PublishProposal[];
  recruit_acquisition: RecruitAcquisitionEvent[];
  recent_alerts: Array<Record<string, unknown>>;
  entity_filter_hint: string;
  todo: string;
  money_auto_approved: false;
  publish_executed: false;
  dual_approve_required: true;
  never_auto_approve_money: true;
  contract_version: typeof PHASE58_MARKETING_CONTRACT_VERSION;
};

export function emptyMarketingHardeningPhase58Report(
  entityId: string | null = null,
): MarketingHardeningPhase58Report {
  return {
    entity_id: entityId,
    in_review_count: 0,
    overdue_count: 0,
    due_soon_count: 0,
    approved_count: 0,
    sla_reliability_pct: null,
    board_status: 'missing',
    publishing_control_status: 'missing',
    brand_voice_status: 'missing',
    performance_status: 'missing',
    pending_jobs: 0,
    failed_jobs: 0,
    posted_jobs: 0,
    voices_configured: 0,
    content_without_voice: 0,
    active_campaigns: 0,
    paid_campaigns: 0,
    organic_campaigns: 0,
    pending_publish_proposals: 0,
    recruit_feed_status: 'missing',
    recruit_applications: 0,
    recruit_clicks: 0,
    snapshot_id: null,
    captured_at: null,
    publish_proposals: [],
    recruit_acquisition: [],
    recent_alerts: [],
    entity_filter_hint: PHASE58_ENTITY_FILTER_HINT,
    // TODO: Refresh board; wire JobTarget/job boards for ENT-R619.
    todo: 'Refresh Marketing hardening board; wire JobTarget/job boards for ENT-R619',
    money_auto_approved: false,
    publish_executed: false,
    dual_approve_required: true,
    never_auto_approve_money: true,
    contract_version: PHASE58_MARKETING_CONTRACT_VERSION,
  };
}

export function boardStatusLabel(status: string): string {
  if (status === 'ok') return 'OK';
  if (status === 'partial') return 'Partial';
  if (status === 'missing') return 'Missing';
  return 'Unknown';
}

export function formatReliabilityPct(
  value: number | null | undefined,
): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value}%`;
}

export function publishActionLabel(kind: string): string {
  if (kind === 'paid_publish') return 'Paid publish';
  if (kind === 'budget_change') return 'Budget change';
  if (kind === 'campaign_go_live') return 'Campaign go-live';
  if (kind === 'brand_voice_override') return 'Brand-voice override';
  return 'Money-impacting action';
}
