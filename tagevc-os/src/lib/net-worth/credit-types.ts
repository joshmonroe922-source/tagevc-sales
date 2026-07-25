/** Client-safe personal credit DTOs (no server imports). */

export type PersonKey = 'josh_monroe' | 'lauren_monroe';

export type FicoScores = {
  fico_8?: number | null;
  fico_10?: number | null;
  fico_9?: number | null;
  fico_auto_8?: number | null;
  fico_auto_10?: number | null;
  fico_bankcard_8?: number | null;
  fico_bankcard_10?: number | null;
  equifax_fico_8?: number | null;
  experian_fico_8?: number | null;
  transunion_fico_8?: number | null;
  equifax_fico_10?: number | null;
  experian_fico_10?: number | null;
  transunion_fico_10?: number | null;
  other?: Record<string, number>;
};

export type CreditSubject = {
  id: string;
  person_key: PersonKey;
  display_name: string;
  relationship: 'self' | 'spouse';
  consent_noted_at: string | null;
  notes: string;
};

export type CreditSnapshot = {
  id: string;
  subject_id: string;
  bureau: 'equifax' | 'experian' | 'transunion' | 'tri_merge' | string;
  pulled_at: string;
  source: string;
  report_date: string | null;
  scores: FicoScores;
  summary: Record<string, unknown>;
  raw_storage_path: string | null;
  parse_status: string;
  parse_errors: string;
  fico_8: number | null;
  fico_10: number | null;
  days_old: number | null;
  stale: boolean;
};

export type CreditConnection = {
  id: string;
  subject_id: string;
  provider: 'myfico' | 'experian' | 'equifax_myequifax' | 'other';
  status: 'connected_guided' | 'stale' | 'disconnected';
  last_successful_pull_at: string | null;
  notes: string;
};

export type CreditAlert = {
  id: string;
  subject_id: string;
  kind: string;
  title: string;
  created_at: string;
  acknowledged_at: string | null;
};

export type CreditGrokMessageDto = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model: string | null;
  created_at: string;
};
