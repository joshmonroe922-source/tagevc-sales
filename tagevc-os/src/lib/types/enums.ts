/**
 * Exact enums from Tage VC Operating System → Data Dictionary /
 * Entity Master / Core Subsidiary Structure.
 * Do not invent synonyms.
 */

/** Pipeline Active stages (Excel Process Map / Lead Process Library). */
export const PIPELINE_STAGES = [
  'Sourced',
  'Screened',
  'First Call',
  'Partner Meeting',
  'Deep Dive Prep',
  'Ready for DD',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Task status on Lead Tasks Active. */
export const TASK_STATUSES = [
  'Not Started',
  'In Progress',
  'Blocked',
  'Completed',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const LEAD_SOURCES = [
  'Warm intro',
  'Inbound',
  'Cold outreach',
  'Event',
  'Scout',
  'Portfolio',
  'LP referral',
  'Other',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_OUTCOMES = [
  'Advanced to DD',
  'Pass',
  'Lost',
  'Withdrawn',
  'Nurture archive',
] as const;
export type LeadOutcome = (typeof LEAD_OUTCOMES)[number];

export const DD_STATUSES = [
  'Not Started',
  'In Progress',
  'Blocked',
  'Waiting on Company',
  'Completed',
  'Waived',
] as const;
export type DdStatus = (typeof DD_STATUSES)[number];

export const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Deal Active execution stages (Data Dictionary — includes Post-Close). */
export const EXEC_STAGES = [
  'IC Approved',
  'Term Sheet',
  'Confirmatory DD',
  'Docs Drafting',
  'Signing Ready',
  'Closing Conditions',
  'Wired / Closed',
  'Post-Close',
] as const;
export type ExecStage = (typeof EXEC_STAGES)[number];

export const DEAL_OUTCOMES = ['Wired / Closed', 'Dead', 'Paused'] as const;
export type DealOutcome = (typeof DEAL_OUTCOMES)[number];

export const THESIS_FITS = ['Strong', 'Medium', 'Weak', 'Unknown'] as const;
export type ThesisFit = (typeof THESIS_FITS)[number];

export const DEAL_PATHS = ['Launch', 'Partner', 'Exit'] as const;
export type DealPath = (typeof DEAL_PATHS)[number];

/** IC decision logging — human gate (forbid-list: ic_approve). */
export const IC_DECISIONS = [
  'Approve',
  'Pass',
  'Defer',
  'Approve with conditions',
] as const;
export type IcDecision = (typeof IC_DECISIONS)[number];

export const IC_REVIEW_STATUSES = [
  'Pending',
  'In Review',
  'Decided',
] as const;
export type IcReviewStatus = (typeof IC_REVIEW_STATUSES)[number];

/** Health — forced enum; COO owns judgment (Core Structure §3). */
export const PORTFOLIO_HEALTH = [
  'On Track',
  'Watch',
  'At Risk',
  'Critical',
] as const;
export type PortfolioHealth = (typeof PORTFOLIO_HEALTH)[number];

/**
 * M&A Pipeline stages (Data Dictionary).
 * Process Map shorthand: Sourced → CIM → Mgmt → IOI → LOI → DD → Docs → Closing → Integration
 */
export const MA_STAGES = [
  'Sourced',
  'CIM Review',
  'Management Meeting',
  'IOI / Indication',
  'LOI / Exclusivity',
  'Confirmatory DD',
  'Definitive Docs',
  'Closing',
  'Integration',
] as const;
export type MaStage = (typeof MA_STAGES)[number];

export const MA_OUTCOMES = ['Acquired', 'Walked', 'Lost', 'Paused'] as const;
export type MaOutcome = (typeof MA_OUTCOMES)[number];

export const MA_DEAL_TYPES = [
  'Platform acquisition',
  'Add-on / roll-up',
  'Merger',
  'Asset purchase',
  'Other',
] as const;
export type MaDealType = (typeof MA_DEAL_TYPES)[number];

export const RE_ROUTES = ['Residential', 'Commercial'] as const;
export type ReRoute = (typeof RE_ROUTES)[number];

/** RE Pipeline stages (Data Dictionary). Final stage Onboard → RE Portfolio. */
export const RE_STAGES = [
  'Sourced',
  'Screen',
  'Underwriting',
  'Offer',
  'LOI / PSA',
  'Diligence',
  'Closing',
  'Onboard',
] as const;
export type ReStage = (typeof RE_STAGES)[number];

export const RE_OUTCOMES = ['Purchased', 'Passed', 'Lost', 'Paused'] as const;
export type ReOutcome = (typeof RE_OUTCOMES)[number];

/** Portfolio Handoff pack status (Portfolio Handoff sheet). */
export const HANDOFF_STATUSES = [
  'Not Started',
  'In Progress',
  'Ready for Portfolio',
  'Linked',
] as const;
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

export const ENTITY_TYPES = [
  'Firm',
  'Subsidiary',
  'RE Asset Entity',
  'Holdco',
  'SPV',
  'Pipeline-only',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const ENTITY_STATUSES = ['Active', 'Inactive', 'Dissolved'] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];

export const DEAL_TRACKS = ['VC Invest', 'M&A Buy', 'RE Buy', 'Firm'] as const;
export type DealTrack = (typeof DEAL_TRACKS)[number];

/** Entity Master industry_module values. */
export const INDUSTRY_MODULES = [
  'Firm',
  'SaaS',
  'Recruiting',
  'Services',
  'Real Estate Resi',
  'Real Estate CRE',
] as const;
export type IndustryModule = (typeof INDUSTRY_MODULES)[number];

export const TICKET_PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_STATUSES = [
  'Open',
  'In Progress',
  'Blocked',
  'Resolved',
  'Closed',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const SS_SERVICES = [
  'Finance',
  'Legal',
  'HR',
  'IT',
  'Marketing',
] as const;
export type SsService = (typeof SS_SERVICES)[number];

/**
 * Shared Services Operating Model §7C — Grok/Cursor autonomy bands.
 * AUTO: ≥90% + allow-list · DRAFT: 60–89% · ESCALATE: <60% / P0 / forbid-list
 */
export const AUTONOMY_BANDS = ['AUTO', 'DRAFT', 'ESCALATE'] as const;
export type AutonomyBand = (typeof AUTONOMY_BANDS)[number];

/** Autonomy growth phase (Excel §7E). Phase 3 ships v0/v1 scaffolding. */
export const AUTONOMY_VERSIONS = ['v0_shadow', 'v1_assist', 'v2_expand', 'v3'] as const;
export type AutonomyVersion = (typeof AUTONOMY_VERSIONS)[number];

/** Forbid-list action codes — never AUTO even at 99% confidence (§7D). */
export const FORBID_ACTIONS = [
  'capital_wire',
  'portfolio_health_change',
  'docusign_capital_send',
  'core_standard_change',
  'external_founder_investor_email',
  'ic_approve',
  'silent_close_p0',
  'role_permission_change',
  'hr_termination',
  'credit_file_write',
  'secret_env_change',
  'data_deletion',
  /** Identity+device sheet 20 — AI CTO never unilateral */
  'identity_account_disable',
  'identity_device_wipe',
  'identity_break_glass',
  'identity_unattended_remote_help',
  'identity_bulk_audit_export',
] as const;
export type ForbidAction = (typeof FORBID_ACTIONS)[number];

/** Allow-listed AUTO action codes (§7C examples). Narrow + reversible only. */
export const ALLOW_ACTIONS = [
  'spawn_missing_stage_tasks',
  'tag_ticket_service',
  'sla_nudge',
  'route_inbound_form',
  'draft_status_summary',
  'retry_failed_parse',
  'retry_noncritical_webhook',
  'clear_stale_cache_flag',
  'document_known_fix',
] as const;
export type AllowAction = (typeof ALLOW_ACTIONS)[number];

export const DATA_FRESHNESS = ['FRESH', 'STALE', 'UNKNOWN'] as const;
export type DataFreshness = (typeof DATA_FRESHNESS)[number];

/** Core Structure §3A roll-up methods. */
export const ROLLUP_METHODS = [
  'SUM',
  'WEIGHTED',
  'MIN',
  'FLAG',
  'COUNT',
  'LIST',
] as const;
export type RollupMethod = (typeof ROLLUP_METHODS)[number];

/** Document Management & Workflow — docs.status */
export const DOC_STATUSES = [
  'Draft',
  'Ready to Send',
  'Sent',
  'Delivered',
  'Signed',
  'Completed',
  'Declined',
  'Voided',
] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export const DOC_TYPES = [
  'NDA',
  'Term Sheet',
  'SPA',
  'APA',
  'SAFE',
  'PSA',
  'Wire Package',
  'Offer Letter',
  'MSA',
  'SOW',
  'Handoff Pack',
  'IC Memo',
  'Other',
] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Entity library folders (§1). */
export const ENTITY_DOC_FOLDERS = [
  '01_Corporate',
  '02_Deal',
  '03_DD',
  '04_Financials',
  '05_HR',
  '06_Ops',
  '07_Signed',
] as const;
export type EntityDocFolder = (typeof ENTITY_DOC_FOLDERS)[number];

/** Capital docs that require explicit human Send (never silent / never agent AUTO). */
export const CAPITAL_DOC_TYPES = [
  'Term Sheet',
  'SPA',
  'APA',
  'SAFE',
  'PSA',
  'Wire Package',
] as const;
export type CapitalDocType = (typeof CAPITAL_DOC_TYPES)[number];
