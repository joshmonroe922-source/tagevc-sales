import { z } from 'zod';
import {
  AUTONOMY_BANDS,
  AUTONOMY_VERSIONS,
  DEAL_PATHS,
  DEAL_TRACKS,
  ENTITY_STATUSES,
  ENTITY_TYPES,
  FORBID_ACTIONS,
  INDUSTRY_MODULES,
  PORTFOLIO_HEALTH,
  SS_SERVICES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
} from '@/lib/types/enums';

export const portfolioHealthSchema = z.enum(PORTFOLIO_HEALTH);
export const dealPathSchema = z.enum(DEAL_PATHS);
export const entityTypeSchema = z.enum(ENTITY_TYPES);
export const entityStatusSchema = z.enum(ENTITY_STATUSES);
export const industryModuleSchema = z.enum(INDUSTRY_MODULES);
export const dealTrackSchema = z.enum(DEAL_TRACKS);

export const entitySchema = z.object({
  id: z.string().uuid(),
  entity_id: z.string().min(1),
  canonical_name: z.string().min(1),
  legal_name: z.string().nullable(),
  entity_type: entityTypeSchema,
  track_origin: dealTrackSchema.nullable(),
  parent_entity_id: z.string().nullable(),
  status: entityStatusSchema,
  industry_module: industryModuleSchema.nullable(),
  qbe_class_or_company: z.string().nullable(),
  portfolio_id: z.string().nullable(),
  coo_owner: z.string().nullable(),
  board_lead: z.string().nullable(),
  close_date: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const portfolioCompanySchema = z.object({
  id: z.string().uuid(),
  portfolio_id: z.string().regex(/^(PF|PFRE)-.+/),
  entity_id: z.string().min(1),
  company_name: z.string().min(1),
  deal_id: z.string().nullable(),
  path: dealPathSchema.nullable(),
  close_date: z.string().nullable(),
  coo_owner: z.string().nullable(),
  board_lead: z.string().nullable(),
  arr_k: z.number(),
  mom_growth: z.number().nullable(),
  net_burn_k: z.number(),
  runway_mo: z.number().nullable(),
  cash_k: z.number(),
  health: portfolioHealthSchema,
  top_risk: z.string().nullable(),
  next_milestone: z.string().nullable(),
  last_update: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const entityMonthPnlSchema = z.object({
  id: z.string().uuid(),
  entity_id: z.string().min(1),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  revenue_arr_k: z.number(),
  cogs_k: z.number(),
  opex_k: z.number(),
  net_burn_k: z.number(),
  ending_cash_k: z.number(),
  is_firm: z.boolean(),
});

export const ticketSchema = z.object({
  id: z.string().uuid(),
  ticket_id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  desired_outcome: z.string().nullable(),
  service: z.enum(SS_SERVICES),
  priority: z.enum(TICKET_PRIORITIES),
  status: z.enum(TICKET_STATUSES),
  requester_name: z.string().nullable(),
  assignee_name: z.string().nullable(),
  entity_id: z.string().nullable(),
  company_name: z.string().nullable(),
  links: z.string().nullable(),
  sla_due_at: z.string().nullable(),
  autonomy_band: z.enum(AUTONOMY_BANDS),
  confidence: z.number().min(0).max(100),
  diagnose_reasoning: z.string(),
  proposed_action: z.string().nullable(),
  forbid_hits: z.array(z.enum(FORBID_ACTIONS)),
  on_allow_list: z.boolean(),
  draft_approval: z.enum(['pending', 'approved', 'rejected', 'n/a']),
  recommendation: z.string().nullable(),
  policy_version: z.enum(AUTONOMY_VERSIONS),
  ai_generated: z.boolean(),
  source_doc_id: z.string().nullable(),
  ai_suggestion_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  resolved_at: z.string().nullable(),
});

export type EntityInput = z.infer<typeof entitySchema>;
export type PortfolioCompanyInput = z.infer<typeof portfolioCompanySchema>;
export type EntityMonthPnlInput = z.infer<typeof entityMonthPnlSchema>;
export type TicketInput = z.infer<typeof ticketSchema>;
