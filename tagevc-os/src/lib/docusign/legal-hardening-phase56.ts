/**
 * Phase 56 — Legal / DocuSign Production Hardening contracts + stubs.
 * Capital sends: propose + dual-approve only; never silent send.
 * Monitoring never creates/voids/resends envelopes.
 */

export const PHASE56_LEGAL_CONTRACT_VERSION = 'phase56-v1' as const;
export const PHASE56_ENTITY_FILTER_HINT = 'ENT-R619';

export type LegalGovernanceStatus = 'ok' | 'partial' | 'missing' | 'unknown';

export type CapitalSendStatus =
  | 'pending'
  | 'rejected'
  | 'dual_approved'
  | 'blocked'
  | 'superseded'
  | 'duplicate_actor_decision';

export type QuarterlyStepStatus =
  | 'open'
  | 'in_progress'
  | 'blocked'
  | 'done'
  | 'waived'
  | 'overdue';

export type LegalQuarterlyStep = {
  event_id?: string;
  entity_id: string | null;
  period_key: string;
  step_key: string;
  step_label: string;
  status: QuarterlyStepStatus | string;
  created_at: string;
};

export type ArchiveIntegrityAlert = {
  alert_id?: string;
  entity_id: string | null;
  alert_kind: string;
  severity: string;
  title: string;
  created_at: string;
};

export type CapitalSendProposal = {
  proposal_id: string;
  entity_id: string | null;
  template_id: string | null;
  doc_id: string | null;
  summary: string;
  proposed_by: string;
  status: CapitalSendStatus | string;
  created_at: string;
};

export type SubsidiaryLegalVisibility = {
  entity_id: string;
  name: string;
  priority: number;
  visibility_status: LegalGovernanceStatus | string;
  open_count: number;
  overdue_count: number;
  has_data: boolean;
  todo: string | null;
};

export type LegalHardeningPhase56Report = {
  entity_id: string | null;
  templates_cached: number;
  templates_with_roles: number;
  templates_stale: number;
  completeness_pct: number | null;
  governance_status: LegalGovernanceStatus;
  pending_capital_send_count: number;
  quarantine_count: number;
  period_key: string;
  snapshot_id: string | null;
  captured_at: string | null;
  quarterly_steps: LegalQuarterlyStep[];
  archive_alerts: ArchiveIntegrityAlert[];
  capital_send_proposals: CapitalSendProposal[];
  recent_alerts: Array<Record<string, unknown>>;
  subsidiaries: SubsidiaryLegalVisibility[];
  entity_filter_hint: string;
  todo: string;
  envelope_send_executed: false;
  never_silent_send: true;
  never_creates_voids_or_resends: true;
  contract_version: typeof PHASE56_LEGAL_CONTRACT_VERSION;
};

const DEFAULT_SUBSIDIARIES: SubsidiaryLegalVisibility[] = [
  {
    entity_id: 'ENT-R619',
    name: 'Recruit 619',
    priority: 1,
    visibility_status: 'missing',
    open_count: 0,
    overdue_count: 0,
    has_data: false,
    // TODO: wire Recruit legal request feed
    todo: 'TODO: wire Recruit legal request feed',
  },
  {
    entity_id: 'ENT-INDA',
    name: 'Instant NDA',
    priority: 2,
    visibility_status: 'missing',
    open_count: 0,
    overdue_count: 0,
    has_data: false,
    // TODO: show ENT-INDA legal requests when evidence exists
    todo: 'TODO: show ENT-INDA legal requests when evidence exists',
  },
];

function currentPeriodKey(now = new Date()): string {
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();
  if (month <= 3) return `${year}-Q1`;
  if (month <= 6) return `${year}-Q2`;
  if (month <= 9) return `${year}-Q3`;
  return `${year}-Q4`;
}

export function emptyLegalHardeningPhase56Report(
  entityId: string | null = null,
): LegalHardeningPhase56Report {
  return {
    entity_id: entityId,
    templates_cached: 0,
    templates_with_roles: 0,
    templates_stale: 0,
    completeness_pct: null,
    governance_status: 'missing',
    pending_capital_send_count: 0,
    quarantine_count: 0,
    period_key: currentPeriodKey(),
    snapshot_id: null,
    captured_at: null,
    quarterly_steps: [],
    archive_alerts: [],
    capital_send_proposals: [],
    recent_alerts: [],
    subsidiaries: DEFAULT_SUBSIDIARIES,
    entity_filter_hint: PHASE56_ENTITY_FILTER_HINT,
    // TODO: Refresh board; sync templates when JWT ready.
    todo: 'Refresh Legal / DocuSign hardening board; sync templates when JWT ready',
    envelope_send_executed: false,
    never_silent_send: true,
    never_creates_voids_or_resends: true,
    contract_version: PHASE56_LEGAL_CONTRACT_VERSION,
  };
}

export function governanceStatusLabel(status: string): string {
  if (status === 'ok') return 'OK';
  if (status === 'partial') return 'Partial';
  if (status === 'missing') return 'Missing';
  return 'Unknown';
}

export function quarterlyStatusLabel(status: string): string {
  if (status === 'in_progress') return 'In progress';
  if (status === 'blocked') return 'Blocked';
  if (status === 'done') return 'Done';
  if (status === 'waived') return 'Waived';
  if (status === 'overdue') return 'Overdue';
  return 'Open';
}

export function formatCompletenessPct(
  value: number | null | undefined,
): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value}%`;
}
