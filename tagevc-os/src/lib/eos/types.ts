/** Traction EOS shared types — rocks, IDS, L10, scorecard, V/TO */

export type EosRockScope = 'company' | 'department' | 'team' | 'personal';
export type EosRockStatus = 'on_track' | 'off_track' | 'done' | 'dropped';
export type EosIssueScope = 'personal' | 'team' | 'company';
export type EosIssueStatus = 'open' | 'discussing' | 'solved' | 'dropped';
export type EosIssuePriority = 'low' | 'medium' | 'high';
export type EosTodoStatus = 'open' | 'done';
export type EosScorecardScope = 'personal' | 'team' | 'company';

export type EosRock = {
  id: string;
  entity_id: string;
  quarter_key: string;
  title: string;
  description?: string | null;
  scope: EosRockScope;
  status: EosRockStatus;
  owner_profile_id: string | null;
};

export type EosIssue = {
  id: string;
  entity_id: string;
  title: string;
  detail: string | null;
  scope: EosIssueScope;
  status: EosIssueStatus;
  priority: EosIssuePriority;
  owner_profile_id: string | null;
  raised_by_profile_id: string | null;
};

export type EosTodo = {
  id: string;
  entity_id: string;
  title: string;
  status: EosTodoStatus;
  assignee_profile_id: string | null;
  due_at: string | null;
};

export type EosScorecardEntry = {
  id: string;
  entity_id: string;
  week_key: string;
  metric_key: string;
  label: string;
  goal: number | null;
  actual: number | null;
  unit: string;
  scope: EosScorecardScope;
  on_track: boolean | null;
};

export type EosVto = {
  entity_id: string;
  core_values: string | null;
  core_focus: string | null;
  ten_year_target: string | null;
  three_year_picture: string | null;
  one_year_plan: string | null;
  marketing_strategy: string | null;
  issues_list_notes: string | null;
};

export type EosEntityRollup = {
  entity_id: string;
  rocks_total: number;
  rocks_on_track: number;
  rocks_off_track: number;
  issues_open: number;
  todos_open: number;
  scorecard_on_track: number;
  scorecard_total: number;
};

export const DEFAULT_L10_AGENDA = [
  { key: 'segue', label: 'Segue', minutes: 5 },
  { key: 'scorecard', label: 'Scorecard', minutes: 5 },
  { key: 'rock_review', label: 'Rock review', minutes: 5 },
  { key: 'customer_employee', label: 'Customer / employee headlines', minutes: 5 },
  { key: 'todo_review', label: 'To-do review', minutes: 5 },
  { key: 'ids', label: 'IDS (Issues)', minutes: 60 },
  { key: 'conclude', label: 'Conclude', minutes: 5 },
] as const;

/**
 * Tage multi-entity left-nav / page titles: `{Entity} Performance Management`.
 * Subsidiary portals use plain `Performance Management` (no company prefix).
 */
export function eosOperatingSystemNavLabel(entityId: string): string {
  switch (entityId) {
    case 'ENT-FIRM':
      return 'Tage VC Performance Management';
    case 'ENT-R619':
      return 'Recruit 619 Performance Management';
    case 'ENT-INDA':
      return 'Instant NDA Performance Management';
    case 'ENT-SIGNENT':
      return 'Signent HR Performance Management';
    default:
      return 'Performance Management';
  }
}

export const EOS_SCOPE_ENTITIES = [
  { value: 'consolidated', label: 'Consolidated' },
  { value: 'ENT-FIRM', label: 'Tage VC' },
  { value: 'ENT-R619', label: 'Recruit 619' },
  { value: 'ENT-SIGNENT', label: 'Signent HR' },
  { value: 'ENT-INDA', label: 'Instant NDA' },
] as const;

export type EosScopeValue = (typeof EOS_SCOPE_ENTITIES)[number]['value'];
