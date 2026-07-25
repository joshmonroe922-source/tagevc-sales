import type {
  AutonomyBand,
  AutonomyVersion,
  CapitalDocType,
  DataFreshness,
  DealOutcome,
  DealPath,
  DealTrack,
  DdStatus,
  DocStatus,
  DocType,
  EntityDocFolder,
  EntityStatus,
  EntityType,
  ExecStage,
  ForbidAction,
  HandoffStatus,
  IcDecision,
  IcReviewStatus,
  IndustryModule,
  LeadOutcome,
  LeadSource,
  MaDealType,
  MaOutcome,
  MaStage,
  PipelineStage,
  PortfolioHealth,
  Priority,
  ReOutcome,
  ReRoute,
  ReStage,
  SsService,
  TaskStatus,
  ThesisFit,
  TicketPriority,
  TicketStatus,
} from './enums';
import type { AppRole } from './roles';

/** Canonical legal entity — Entity Master (ENT-*). */
export type Entity = {
  id: string;
  entity_id: string;
  canonical_name: string;
  legal_name: string | null;
  entity_type: EntityType;
  track_origin: DealTrack | null;
  parent_entity_id: string | null;
  status: EntityStatus;
  industry_module: IndustryModule | null;
  qbe_class_or_company: string | null;
  portfolio_id: string | null;
  coo_owner: string | null;
  board_lead: string | null;
  close_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
  entity_id: string | null;
  avatar_url: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

/** VC pipeline lead — LD-###. Join pre-close on company_name. */
export type Lead = {
  id: string;
  lead_id: string;
  company_name: string;
  website: string | null;
  sector: string | null;
  source: LeadSource | string | null;
  source_detail: string | null;
  stage: PipelineStage;
  priority: Priority;
  owner: string | null;
  next_action: string | null;
  next_action_date: string | null;
  thesis_fit: ThesisFit | null;
  score: number | null;
  raise_stage: string | null;
  check_size_k: number | null;
  location: string | null;
  path: DealPath | null;
  notes: string | null;
  outcome: LeadOutcome | null;
  /** Linked Deal once converted toward IC / Deal Active. */
  deal_id: string | null;
  /**
   * Optional link to an existing Entity Master row (follow-on / add-on /
   * inbound related to a portfolio company). Pre-close join remains company_name.
   */
  related_entity_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

/** Lead Process Library row (LS-##). */
export type LeadProcessTemplate = {
  lib_id: string;
  process_stage: PipelineStage | 'Sourcing Ops';
  title: string;
  default_priority: Priority;
  owner_role: string;
  what_good_looks_like: string;
};

/** Lead Tasks Active — LT-###. */
export type LeadTask = {
  id: string;
  task_id: string;
  lead_id: string;
  company_name: string;
  process_stage: string;
  title: string;
  priority: Priority;
  status: TaskStatus;
  owner: string | null;
  due_date: string | null;
  notes: string | null;
  /** Process library id that spawned this task (spawn-once key). */
  lib_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

/** VC post-IC deal execution — DE-###. */
export type Deal = {
  id: string;
  deal_id: string;
  lead_id: string | null;
  company_name: string;
  entity_id: string | null;
  exec_stage: ExecStage;
  priority: Priority;
  instrument: string | null;
  premoney_m: number | null;
  check_k: number | null;
  ownership_pct: number | null;
  counsel: string | null;
  path: DealPath | null;
  outcome: DealOutcome | null;
  owner: string | null;
  next_action: string | null;
  /** Linked Portfolio Handoff pack (PH-###) after wire. */
  handoff_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

/** Deal Process Library row (DX-##). */
export type DealProcessTemplate = {
  lib_id: string;
  process_stage: ExecStage;
  title: string;
  default_priority: Priority;
  owner_role: string;
  what_good_looks_like: string;
};

/** Deal Tasks Active — DT-###. */
export type DealTask = {
  id: string;
  task_id: string;
  deal_id: string;
  company_name: string;
  process_stage: string;
  title: string;
  priority: Priority;
  status: TaskStatus;
  owner: string | null;
  due_date: string | null;
  notes: string | null;
  lib_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

/**
 * Investment Committee review — human gate before advancing past IC Approved.
 * Linked to Deal Active (DE-###). Append-only decision events in audit.
 */
export type IcReview = {
  id: string;
  ic_id: string;
  deal_id: string;
  company_name: string;
  status: IcReviewStatus;
  decision: IcDecision | null;
  conditions: string | null;
  recommendation: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Append-only IC decision audit row. */
export type IcAuditEvent = {
  id: string;
  event_id: string;
  ic_id: string;
  deal_id: string;
  action: string;
  decision: IcDecision | null;
  detail: string;
  actor: string;
  created_at: string;
};

/**
 * Portfolio Handoff Pack — PH-###.
 * Created at wire / acquire / purchase; seam into Portfolio Active.
 */
export type HandoffPack = {
  id: string;
  handoff_id: string;
  track: DealTrack;
  /** DE-### | MA-### | RE-### */
  source_id: string;
  company_name: string;
  entity_id: string | null;
  portfolio_id: string | null;
  status: HandoffStatus;
  path: DealPath | null;
  close_date: string | null;
  thesis: string | null;
  checklist_notes: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Portfolio Active row — PF-### / PFRE-###.
 * CORE $ fields must match same-period Portfolio Roll-up entity column.
 */
export type PortfolioCompany = {
  id: string;
  portfolio_id: string;
  entity_id: string;
  company_name: string;
  deal_id: string | null;
  path: DealPath | null;
  close_date: string | null;
  coo_owner: string | null;
  board_lead: string | null;
  /** Revenue / ARR ($k) — CORE */
  arr_k: number;
  /** MoM growth as decimal (0.12 = 12%) — CORE */
  mom_growth: number | null;
  /** Net Burn ($k) — CORE */
  net_burn_k: number;
  /** Runway months; null when not burning — CORE */
  runway_mo: number | null;
  /** Ending Cash ($k) — CORE */
  cash_k: number;
  health: PortfolioHealth;
  top_risk: string | null;
  next_milestone: string | null;
  last_update: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/** Monthly CORE P&L inputs by entity (Portfolio Roll-up §A blue cells). */
export type EntityMonthPnl = {
  id: string;
  entity_id: string;
  period: string;
  revenue_arr_k: number;
  cogs_k: number;
  opex_k: number;
  net_burn_k: number;
  ending_cash_k: number;
  /** Firm-only column when entity is ENT-FIRM */
  is_firm: boolean;
};

/** Roll-up method from Core Subsidiary Structure §3A. */
export type KpiRollupMethod =
  | 'SUM'
  | 'WEIGHTED'
  | 'MIN_FLAG'
  | 'COUNT'
  | 'LIST'
  | 'n/a';

/**
 * Monthly CORE KPI fact — entity_month_kpi (Core Structure §3).
 * Do not invent alternate kpi_key names.
 */
export type EntityMonthKpi = {
  id: string;
  entity_id: string;
  period: string;
  kpi_key: string;
  label: string;
  value_num: number | null;
  value_text: string | null;
  unit: string | null;
  method: KpiRollupMethod;
  /** Always CORE for this table. */
  standard: 'CORE';
};

/**
 * Monthly FLEX KPI fact — entity_month_kpi_flex (§3C).
 * Never rolls into portfolio money totals (cols E–G).
 */
export type EntityMonthKpiFlex = {
  id: string;
  entity_id: string;
  period: string;
  flex_key: string;
  label: string;
  value_num: number | null;
  value_text: string | null;
  unit: string | null;
  industry_module: IndustryModule | string;
  standard: 'FLEX';
};

/** Unified task row for Subsidiary OS task visibility. */
export type EntityLinkedTask = {
  task_id: string;
  title: string;
  track: 'VC Lead' | 'VC Deal' | 'M&A' | 'RE' | 'Shared Services';
  parent_id: string;
  process_stage: string | null;
  priority: string;
  status: string;
  owner: string | null;
  due_date: string | null;
  href: string;
};

/** Joined Subsidiary Operating System view (Platform Spec §8 entity page). */
export type EntityOperatingView = {
  entity: Entity;
  portfolio: PortfolioCompany | null;
  period: string;
  pnl: EntityMonthPnl | null;
  core_kpis: EntityMonthKpi[];
  flex_kpis: EntityMonthKpiFlex[];
  documents: DocumentRecord[];
  tickets: Ticket[];
  leads: Lead[];
  deals: Deal[];
  ma_targets: MaTarget[];
  re_deals: ReDeal[];
  tasks: {
    deal_flow: EntityLinkedTask[];
    shared_services: EntityLinkedTask[];
  };
  /** Primary inbound / origin lead source when known. */
  origin_source: string | null;
  /** Recent financial / KPI edit audits (Phase 18+). */
  financial_audits: FinancialAuditSummary[] | null;
  /**
   * Phase 53 Subsidiary Rollup Hub (Recruit 619 / ENT-R619 first).
   * Null for entities without a rollup feed surface.
   */
  subsidiary_rollup?: import('@/lib/data/subsidiary-rollup-phase53').SubsidiaryRollupPhase53Report | null;
};

export type FinancialAuditSummary = {
  id: string;
  audit_id: string;
  entity_id: string;
  portfolio_id: string | null;
  period: string;
  actor_email: string | null;
  patch: Record<string, unknown>;
  created_at: string;
};

/**
 * Shared Services ticket — SS Operating Model §7.
 * Intake → Diagnose (band + confidence) → Act → Resolve → Learn.
 */
export type Ticket = {
  id: string;
  ticket_id: string;
  title: string;
  description: string | null;
  /** Desired outcome stated by requester. */
  desired_outcome: string | null;
  service: SsService;
  priority: TicketPriority;
  status: TicketStatus;
  requester_name: string | null;
  assignee_name: string | null;
  entity_id: string | null;
  company_name: string | null;
  links: string | null;
  sla_due_at: string | null;
  /** Diagnosed autonomy band. */
  autonomy_band: AutonomyBand;
  /** 0–100 confidence from diagnose step. */
  confidence: number;
  /** Agent reasoning for band (audit). */
  diagnose_reasoning: string;
  /** AI-written human-readable summary (Phase 76). */
  diagnose_summary?: string;
  /** Proposed / matched action code (allow or forbid). */
  proposed_action: string | null;
  /** Structured proposed steps (Phase 76). */
  proposed_actions?: Array<{
    code: string;
    label: string;
    requires_human: boolean;
    note?: string;
  }>;
  /** Forbid-list hits (empty if none). */
  forbid_hits: ForbidAction[];
  /** True if proposed action is on AUTO allow-list. */
  on_allow_list: boolean;
  /** Human approval state for DRAFT band. */
  draft_approval: 'pending' | 'approved' | 'rejected' | 'n/a';
  /** Agent recommendation text (especially ESCALATE / DRAFT). */
  recommendation: string | null;
  /** Autonomy policy version at diagnose time. */
  policy_version: AutonomyVersion;
  /** Phase 4.5 — created from document AI review. */
  ai_generated: boolean;
  source_doc_id: string | null;
  ai_suggestion_id: string | null;
  /** Phase 76 provenance */
  source_system?: 'tage' | 'recruit619' | 'instantnda' | 'system';
  source_ref?: string | null;
  auto_attempted_at?: string | null;
  auto_result?: 'success' | 'partial' | 'failed' | 'skipped' | null;
  escalation_reason?: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

/** Append-only agent audit row (§7F). */
export type AgentAuditLog = {
  id: string;
  audit_id: string;
  ticket_id: string;
  band: AutonomyBand;
  confidence: number;
  action: string;
  reasoning: string;
  forbid_hits: ForbidAction[];
  approval: string | null;
  payload_hash: string | null;
  actor: 'agent' | 'human';
  created_at: string;
};

export type DiagnoseResult = {
  band: AutonomyBand;
  confidence: number;
  reasoning: string;
  proposed_action: string | null;
  forbid_hits: ForbidAction[];
  on_allow_list: boolean;
  recommendation: string;
  policy_version: AutonomyVersion;
};

export type Task = {
  id: string;
  task_id: string;
  company_name: string | null;
  parent_id: string | null;
  process_stage: string | null;
  title: string;
  priority: Priority;
  status: DdStatus | 'Not Started' | 'In Progress' | 'Blocked' | 'Completed';
  owner: string | null;
  due_date: string | null;
  notes: string | null;
  track: DealTrack | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

/** M&A Pipeline target — MA-###. */
export type MaTarget = {
  id: string;
  ma_id: string;
  company_name: string;
  website: string | null;
  sector: string | null;
  deal_type: MaDealType | null;
  source: string | null;
  stage: MaStage;
  priority: Priority;
  owner: string | null;
  enterprise_value_m: number | null;
  revenue_m: number | null;
  ebitda_m: number | null;
  next_action: string | null;
  next_action_date: string | null;
  exclusivity_end: string | null;
  strategic_fit: ThesisFit | null;
  notes: string | null;
  outcome: MaOutcome | null;
  entity_id: string | null;
  handoff_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

/** M&A Process Library row (MA-##). */
export type MaProcessTemplate = {
  lib_id: string;
  process_stage: MaStage;
  title: string;
  default_priority: Priority;
  owner_role: string;
  what_good_looks_like: string;
};

/** M&A Tasks Active — MT-###. */
export type MaTask = {
  id: string;
  task_id: string;
  ma_id: string;
  company_name: string;
  process_stage: string;
  title: string;
  priority: Priority;
  status: TaskStatus;
  owner: string | null;
  due_date: string | null;
  notes: string | null;
  lib_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

/** RE Pipeline deal — RE-###. */
export type ReDeal = {
  id: string;
  re_id: string;
  asset_name: string;
  route: ReRoute;
  asset_type: string | null;
  market: string | null;
  source: string | null;
  stage: ReStage;
  priority: Priority;
  sourcer: string | null;
  ask_k: number | null;
  offer_k: number | null;
  noi_k: number | null;
  cap_yield_signal: string | null;
  next_action: string | null;
  next_action_date: string | null;
  notes: string | null;
  outcome: ReOutcome | null;
  entity_id: string | null;
  handoff_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

/** RE Process Library row (RE-##). Route filter: Both | Residential | Commercial. */
export type ReProcessTemplate = {
  lib_id: string;
  route: 'Both' | ReRoute;
  process_stage: ReStage | 'Sourcing Ops';
  title: string;
  default_priority: Priority;
  owner_role: string;
  what_good_looks_like: string;
};

/** RE Tasks Active — RT-###. */
export type ReTask = {
  id: string;
  task_id: string;
  re_id: string;
  asset_name: string;
  route: ReRoute;
  process_stage: string;
  title: string;
  priority: Priority;
  status: TaskStatus;
  owner: string | null;
  due_date: string | null;
  notes: string | null;
  lib_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type PortfolioHealthCounts = Record<PortfolioHealth, number>;

export type PortfolioRollup = {
  period: string;
  portfolio_arr_k: number;
  portfolio_cogs_k: number;
  portfolio_gross_profit_k: number;
  /** WEIGHTED = ΣGP / ΣRev — never avg of entity margins */
  portfolio_gross_margin: number | null;
  portfolio_opex_k: number;
  portfolio_ebitda_k: number;
  portfolio_net_burn_k: number;
  portfolio_cash_k: number;
  firm_cash_k: number;
  consolidated_cash_k: number;
  /** MIN runway among entities with burn > 0 */
  min_runway_mo: number | null;
  runway_breach: boolean;
  health_counts: PortfolioHealthCounts;
  active_company_count: number;
  attention_required: number;
};

export type CommandCenterSnapshot = {
  period: string | null;
  freshness: DataFreshness;
  funnel: {
    active_leads: number;
    ready_for_dd: number;
    open_dd_tasks: number;
    blocked_dd_tasks: number;
    active_deals: number;
    deals_in_closing: number;
  };
  portfolio_health: PortfolioHealthCounts;
  capital: {
    portfolio_arr_k: number;
    portfolio_gross_margin: number | null;
    portfolio_net_burn_k: number;
    portfolio_cash_k: number;
    firm_cash_k: number;
    consolidated_cash_k: number;
    min_runway_mo: number | null;
    runway_breach: boolean;
  };
  active_portfolio_companies: number;
  attention_required: number;
};

/** Joined Portfolio Active + Entity Master for UI. */
export type PortfolioCompanyDetail = PortfolioCompany & {
  entity: Entity | null;
};

/** DocuSign / library template under /Templates. */
export type DocTemplate = {
  template_id: string;
  name: string;
  doc_type: DocType;
  folder_hint: EntityDocFolder | 'Templates' | 'Firm/Corporate' | 'Firm/IC_Memos';
  body: string;
  /** Requires human Click Send — capital docs. */
  requires_human_send: boolean;
  merge_tokens: string[];
};

/**
 * Portal docs table (Excel §5).
 * doc_id | entity_id | deal_or_task_id | doc_type | template_id | status | envelope_id
 */
export type DocumentRecord = {
  id: string;
  doc_id: string;
  entity_id: string | null;
  deal_or_task_id: string | null;
  doc_type: DocType;
  template_id: string | null;
  title: string;
  /** Library path e.g. /Entities/ENT-002/02_Deal/... */
  library_path: string;
  folder: string;
  status: DocStatus;
  envelope_id: string | null;
  /** Merged content preview (mock PDF/DOCX body). */
  merged_body: string | null;
  /** Confirmed merge map snapshot. */
  merge_values: Record<string, string>;
  signers: Array<{ name: string; email: string; order: number; role: string }>;
  /** Human who clicked Send (required for capital). */
  sent_by: string | null;
  sent_at: string | null;
  completed_at: string | null;
  content_hash: string | null;
  notes: string | null;
  /** Phase 4.5 — AI document intelligence */
  ai_review: DocumentAiReview | null;
  created_at: string;
  updated_at: string;
};

export type AiSuggestionStatus = 'pending' | 'accepted' | 'dismissed' | 'edited';

export type DocumentAiSuggestion = {
  suggestion_id: string;
  kind:
    | 'expiration_followup'
    | 'renewal'
    | 'missing_document'
    | 'obligation'
    | 'other';
  title: string;
  description: string;
  due_date: string | null;
  service: SsService;
  priority: TicketPriority;
  status: AiSuggestionStatus;
  /** Ticket created when accepted / auto-created pending review. */
  ticket_id: string | null;
  created_at: string;
  resolved_at: string | null;
};

export type DocumentAiReview = {
  reviewed_at: string;
  /** Heuristic | llm — swap implementation later. */
  engine: 'heuristic_v1' | 'llm';
  summary: string;
  expiration_date: string | null;
  renewal_date: string | null;
  time_sensitive: boolean;
  confidence: number;
  suggestions: DocumentAiSuggestion[];
};

export type DocAuditEvent = {
  id: string;
  event_id: string;
  doc_id: string;
  action: string;
  actor: 'human' | 'system' | 'webhook' | 'ai';
  detail: string;
  created_at: string;
};

export type { CapitalDocType, EntityDocFolder };
