/** Client-safe constants/types for demo data cleanup (no server imports). */

export const CLEANUP_CONFIRM_PHRASE = 'DELETE DEMO DATA';

export const PROTECTED_ENTITY_IDS = new Set([
  'ENT-FIRM',
  'ENT-R619',
  'ENT-INDA',
  'ENT-002', // legacy Instant NDA alias
]);

export const SAMPLE_ENTITY_IDS = new Set(['ENT-001', 'ENT-003']);

export type DemoDomain =
  | 'entities_sample'
  | 'leads_sample'
  | 'tickets_seed'
  | 'portfolio_sample'
  | 'hris_sample';

export type DomainCount = {
  domain: DemoDomain;
  label: string;
  count: number;
  sample_ids: string[];
};

export type CleanupInventory = {
  generated_at: string;
  domains: DomainCount[];
  protected_notes: string[];
  recruit_inda_notes: string[];
};

export type CleanupExecuteResult = {
  ok: boolean;
  dry_run: boolean;
  before: DomainCount[];
  after: DomainCount[];
  actions: string[];
  error?: string;
};
