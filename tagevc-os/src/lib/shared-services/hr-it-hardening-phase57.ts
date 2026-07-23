/**
 * Phase 57 — HR + IT Production Hardening contracts + stubs.
 * High-risk actions: propose + dual-approve only; never auto-close breakers.
 * Reuses multi-sub identity lifecycle (P5) and Intune dual-approve inbox.
 */

export const PHASE57_HR_IT_CONTRACT_VERSION = 'phase57-v1' as const;
export const PHASE57_ENTITY_FILTER_HINT = 'ENT-R619';

export type HrItBoardStatus = 'ok' | 'partial' | 'missing' | 'unknown';

export type HighRiskActionKind =
  | 'breaker_close'
  | 'access_revoke_execute'
  | 'offboarding_force_complete'
  | 'onboarding_force_complete'
  | 'other_high_risk';

export type HighRiskStatus =
  | 'pending'
  | 'rejected'
  | 'dual_approved'
  | 'blocked'
  | 'superseded'
  | 'duplicate_actor_decision';

export type AgingAlert = {
  alert_id?: string;
  entity_id: string | null;
  alert_kind: string;
  severity: string;
  title: string;
  age_hours: number;
  created_at: string;
};

export type EscalationEvent = {
  event_id?: string;
  entity_id: string | null;
  escalation_kind: string;
  reference_id: string | null;
  title: string;
  status: string;
  created_at: string;
};

export type HighRiskProposal = {
  proposal_id: string;
  entity_id: string | null;
  action_kind: HighRiskActionKind | string;
  summary: string;
  proposed_by: string;
  status: HighRiskStatus | string;
  created_at: string;
};

export type RevocationEvidence = {
  evidence_id?: string;
  entity_id: string | null;
  run_id: string | null;
  user_ref: string | null;
  revocation_kind: string;
  evidence_status: string;
  created_at: string;
};

export type SubsidiaryHrItVisibility = {
  entity_id: string;
  name: string;
  priority: number;
  visibility_status: HrItBoardStatus | string;
  open_runs: number;
  aging_alerts: number;
  has_data: boolean;
  todo: string | null;
};

export type DualApproveInboxItem = {
  kind?: string;
  reference_id?: string;
  awaiting_since?: string;
  [key: string]: unknown;
};

export type HrItHardeningPhase57Report = {
  entity_id: string | null;
  onboarding_open: number;
  onboarding_completed: number;
  offboarding_open: number;
  offboarding_completed: number;
  identity_lifecycle_open: number;
  completeness_pct: number | null;
  board_status: HrItBoardStatus;
  assignment_visibility_status: HrItBoardStatus | string;
  hardware_assigned: number;
  hardware_in_stock: number;
  license_seats_used: number;
  license_seats_total: number;
  pending_high_risk_count: number;
  inbox_pending_count: number;
  inbox_stale_count: number;
  inbox_critical_count: number;
  snapshot_id: string | null;
  captured_at: string | null;
  aging_alerts: AgingAlert[];
  escalations: EscalationEvent[];
  high_risk_proposals: HighRiskProposal[];
  revocation_evidence: RevocationEvidence[];
  inbox_items: DualApproveInboxItem[];
  recent_alerts: Array<Record<string, unknown>>;
  subsidiaries: SubsidiaryHrItVisibility[];
  entity_filter_hint: string;
  todo: string;
  breaker_auto_closed: false;
  access_revoke_executed: false;
  dual_approve_required: true;
  never_auto_close_breakers: true;
  contract_version: typeof PHASE57_HR_IT_CONTRACT_VERSION;
};

const DEFAULT_SUBSIDIARIES: SubsidiaryHrItVisibility[] = [
  {
    entity_id: 'ENT-R619',
    name: 'Recruit 619',
    priority: 1,
    visibility_status: 'missing',
    open_runs: 0,
    aging_alerts: 0,
    has_data: false,
    // TODO: wire Recruit HR/IT run feed
    todo: 'TODO: wire Recruit HR/IT run feed',
  },
  {
    entity_id: 'ENT-INDA',
    name: 'Instant NDA',
    priority: 2,
    visibility_status: 'missing',
    open_runs: 0,
    aging_alerts: 0,
    has_data: false,
    // TODO: show ENT-INDA HR/IT runs when evidence exists
    todo: 'TODO: show ENT-INDA HR/IT runs when evidence exists',
  },
];

export function emptyHrItHardeningPhase57Report(
  entityId: string | null = null,
): HrItHardeningPhase57Report {
  return {
    entity_id: entityId,
    onboarding_open: 0,
    onboarding_completed: 0,
    offboarding_open: 0,
    offboarding_completed: 0,
    identity_lifecycle_open: 0,
    completeness_pct: null,
    board_status: 'missing',
    assignment_visibility_status: 'missing',
    hardware_assigned: 0,
    hardware_in_stock: 0,
    license_seats_used: 0,
    license_seats_total: 0,
    pending_high_risk_count: 0,
    inbox_pending_count: 0,
    inbox_stale_count: 0,
    inbox_critical_count: 0,
    snapshot_id: null,
    captured_at: null,
    aging_alerts: [],
    escalations: [],
    high_risk_proposals: [],
    revocation_evidence: [],
    inbox_items: [],
    recent_alerts: [],
    subsidiaries: DEFAULT_SUBSIDIARIES,
    entity_filter_hint: PHASE57_ENTITY_FILTER_HINT,
    // TODO: Refresh board; complete open onboarding/offboarding runs.
    todo: 'Refresh HR + IT hardening board; complete open onboarding/offboarding runs',
    breaker_auto_closed: false,
    access_revoke_executed: false,
    dual_approve_required: true,
    never_auto_close_breakers: true,
    contract_version: PHASE57_HR_IT_CONTRACT_VERSION,
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

export function highRiskActionLabel(kind: string): string {
  if (kind === 'breaker_close') return 'Breaker close';
  if (kind === 'access_revoke_execute') return 'Access revoke';
  if (kind === 'offboarding_force_complete') return 'Force-complete offboarding';
  if (kind === 'onboarding_force_complete') return 'Force-complete onboarding';
  return 'High-risk action';
}
