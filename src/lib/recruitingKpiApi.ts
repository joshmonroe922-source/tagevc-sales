/**
 * Recruit 619 KPI hierarchy — portal mirror of TalentDesk org dimensions.
 * Hierarchy: Recruiter → Manager → Location → Region → COO
 */

import { requireSupabase } from './supabase';

export type RecruitingRegion = {
  id: string;
  entity_id: string;
  name: string;
  code: string;
  salesforce_id: string | null;
  sort_order: number;
};

export type RecruitingLocation = {
  id: string;
  entity_id: string;
  region_id: string;
  name: string;
  code: string;
  salesforce_id: string | null;
  sort_order: number;
};

export type RecruitingOrgMember = {
  id: string;
  entity_id: string;
  sales_user_id: string | null;
  email: string;
  display_name: string;
  role: string;
  manager_member_id: string | null;
  location_id: string | null;
  sf_user_id: string | null;
  talentdesk_user_id: string | null;
  active: boolean;
};

export type RecruitingKpiFact = {
  id: string;
  entity_id: string;
  member_id: string;
  period_key: string;
  manager_member_id: string | null;
  location_id: string | null;
  region_id: string | null;
  send_outs: number;
  interviews: number;
  job_board_applies: number;
  placements: number;
  revenue: number;
  commissions_earned: number;
  commissions_paid: number;
  time_to_fill_days: number | null;
  notes: string;
  source: string;
};

export type HierarchyLevel =
  | 'recruiter'
  | 'manager'
  | 'location'
  | 'region'
  | 'coo';

export type HierarchyMetricRow = {
  id: string;
  name: string;
  level: HierarchyLevel;
  recruiterCount: number;
  send_outs: number;
  interviews: number;
  job_board_applies: number;
  placements: number;
  revenue: number;
  commissions_earned: number;
  commissions_paid: number;
  time_to_fill_days: number | null;
  send_outs_per_placement: number | null;
};

export const RECRUITING_KPI_PACK = [
  {
    key: 'send_outs',
    label: 'Send outs / submittals',
    unit: 'count',
    dateBasis: 'activity',
  },
  {
    key: 'interviews',
    label: 'Interviews',
    unit: 'count',
    dateBasis: 'activity',
  },
  {
    key: 'job_board_applies',
    label: 'Job board applies',
    unit: 'count',
    dateBasis: 'activity',
  },
  {
    key: 'placements',
    label: 'Placements / starts',
    unit: 'count',
    dateBasis: 'placement',
  },
  {
    key: 'send_outs_per_placement',
    label: 'Send outs per placement',
    unit: 'ratio',
    dateBasis: 'derived',
  },
  {
    key: 'revenue',
    label: 'Revenue',
    unit: 'USD',
    dateBasis: 'placement',
  },
  {
    key: 'commissions_earned',
    label: 'Commissions earned',
    unit: 'USD',
    dateBasis: 'placement',
  },
  {
    key: 'commissions_paid',
    label: 'Commissions paid',
    unit: 'USD',
    dateBasis: 'commission_paid',
  },
  {
    key: 'time_to_fill_days',
    label: 'Time to fill (avg days)',
    unit: 'days',
    dateBasis: 'placement',
  },
] as const;

function ratioOrNull(num: number, den: number): number | null {
  if (den <= 0) return null;
  return Math.round((num / den) * 10) / 10;
}

function avgDays(facts: RecruitingKpiFact[]): number | null {
  const vals = facts
    .map((f) => f.time_to_fill_days)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

function sumFacts(
  id: string,
  name: string,
  level: HierarchyLevel,
  facts: RecruitingKpiFact[],
): HierarchyMetricRow {
  const send_outs = facts.reduce((s, f) => s + Number(f.send_outs || 0), 0);
  const interviews = facts.reduce((s, f) => s + Number(f.interviews || 0), 0);
  const job_board_applies = facts.reduce(
    (s, f) => s + Number(f.job_board_applies || 0),
    0,
  );
  const placements = facts.reduce((s, f) => s + Number(f.placements || 0), 0);
  const revenue = facts.reduce((s, f) => s + Number(f.revenue || 0), 0);
  const commissions_earned = facts.reduce(
    (s, f) => s + Number(f.commissions_earned || 0),
    0,
  );
  const commissions_paid = facts.reduce(
    (s, f) => s + Number(f.commissions_paid || 0),
    0,
  );
  return {
    id,
    name,
    level,
    recruiterCount: new Set(facts.map((f) => f.member_id)).size,
    send_outs,
    interviews,
    job_board_applies,
    placements,
    revenue,
    commissions_earned,
    commissions_paid,
    time_to_fill_days: avgDays(facts),
    send_outs_per_placement: ratioOrNull(send_outs, placements),
  };
}

export async function listRecruitingRegions(
  entityId: string,
): Promise<RecruitingRegion[]> {
  const { data, error } = await requireSupabase()
    .from('recruiting_regions')
    .select('*')
    .eq('entity_id', entityId)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as RecruitingRegion[];
}

export async function listRecruitingLocations(
  entityId: string,
): Promise<RecruitingLocation[]> {
  const { data, error } = await requireSupabase()
    .from('recruiting_locations')
    .select('*')
    .eq('entity_id', entityId)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as RecruitingLocation[];
}

export async function listRecruitingOrgMembers(
  entityId: string,
): Promise<RecruitingOrgMember[]> {
  const { data, error } = await requireSupabase()
    .from('recruiting_org_members')
    .select('*')
    .eq('entity_id', entityId)
    .eq('active', true)
    .order('display_name');
  if (error) throw error;
  return (data ?? []) as RecruitingOrgMember[];
}

export async function listRecruitingKpiFacts(
  entityId: string,
  periodKey: string,
): Promise<RecruitingKpiFact[]> {
  const { data, error } = await requireSupabase()
    .from('recruiting_kpi_facts')
    .select('*')
    .eq('entity_id', entityId)
    .eq('period_key', periodKey);
  if (error) throw error;
  return (data ?? []) as RecruitingKpiFact[];
}

export async function upsertRecruitingRegion(input: {
  entity_id: string;
  name: string;
  code: string;
  sort_order?: number;
}): Promise<void> {
  const { error } = await requireSupabase().from('recruiting_regions').upsert(
    {
      entity_id: input.entity_id,
      name: input.name.trim(),
      code: input.code.trim().toUpperCase(),
      sort_order: input.sort_order ?? 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'entity_id,code' },
  );
  if (error) throw error;
}

export async function upsertRecruitingLocation(input: {
  entity_id: string;
  region_id: string;
  name: string;
  code: string;
  sort_order?: number;
}): Promise<void> {
  const { error } = await requireSupabase()
    .from('recruiting_locations')
    .upsert(
      {
        entity_id: input.entity_id,
        region_id: input.region_id,
        name: input.name.trim(),
        code: input.code.trim().toUpperCase(),
        sort_order: input.sort_order ?? 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'entity_id,code' },
    );
  if (error) throw error;
}

export async function upsertRecruitingOrgMember(input: {
  entity_id: string;
  email: string;
  display_name?: string;
  role?: string;
  manager_member_id?: string | null;
  location_id?: string | null;
  sales_user_id?: string | null;
}): Promise<void> {
  const { error } = await requireSupabase()
    .from('recruiting_org_members')
    .upsert(
      {
        entity_id: input.entity_id,
        email: input.email.trim().toLowerCase(),
        display_name: (input.display_name ?? input.email).trim(),
        role: input.role ?? 'recruiter',
        manager_member_id: input.manager_member_id ?? null,
        location_id: input.location_id ?? null,
        sales_user_id: input.sales_user_id ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'entity_id,email' },
    );
  if (error) throw error;
}

export async function upsertRecruitingKpiFact(input: {
  entity_id: string;
  member_id: string;
  period_key: string;
  manager_member_id?: string | null;
  location_id?: string | null;
  region_id?: string | null;
  send_outs?: number;
  interviews?: number;
  job_board_applies?: number;
  placements?: number;
  revenue?: number;
  commissions_earned?: number;
  commissions_paid?: number;
  time_to_fill_days?: number | null;
  notes?: string;
  source?: string;
  recorded_by?: string | null;
}): Promise<void> {
  const { error } = await requireSupabase().from('recruiting_kpi_facts').upsert(
    {
      entity_id: input.entity_id,
      member_id: input.member_id,
      period_key: input.period_key,
      manager_member_id: input.manager_member_id ?? null,
      location_id: input.location_id ?? null,
      region_id: input.region_id ?? null,
      send_outs: input.send_outs ?? 0,
      interviews: input.interviews ?? 0,
      job_board_applies: input.job_board_applies ?? 0,
      placements: input.placements ?? 0,
      revenue: input.revenue ?? 0,
      commissions_earned: input.commissions_earned ?? 0,
      commissions_paid: input.commissions_paid ?? 0,
      time_to_fill_days: input.time_to_fill_days ?? null,
      notes: input.notes ?? '',
      source: input.source ?? 'manual',
      recorded_by: input.recorded_by ?? null,
      recorded_at: new Date().toISOString(),
    },
    { onConflict: 'member_id,period_key' },
  );
  if (error) throw error;
}

/** Build rollup rows from facts + org members for a period. */
export function buildHierarchyRollups(input: {
  facts: RecruitingKpiFact[];
  members: RecruitingOrgMember[];
  locations: RecruitingLocation[];
  regions: RecruitingRegion[];
}): {
  recruiters: HierarchyMetricRow[];
  managers: HierarchyMetricRow[];
  locations: HierarchyMetricRow[];
  regions: HierarchyMetricRow[];
  coo: HierarchyMetricRow;
} {
  const { facts, members, locations, regions } = input;
  const memberById = new Map(members.map((m) => [m.id, m]));

  const recruiters = facts.map((f) => {
    const m = memberById.get(f.member_id);
    return sumFacts(
      f.member_id,
      m?.display_name || m?.email || f.member_id,
      'recruiter',
      [f],
    );
  });

  const managerIds = [
    ...new Set(
      facts
        .map((f) => f.manager_member_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const managers = managerIds.map((id) => {
    const m = memberById.get(id);
    return sumFacts(
      id,
      m?.display_name || m?.email || id,
      'manager',
      facts.filter((f) => f.manager_member_id === id),
    );
  });

  const locationRows = locations.map((loc) =>
    sumFacts(
      loc.id,
      loc.name,
      'location',
      facts.filter((f) => f.location_id === loc.id),
    ),
  );

  const regionRows = regions.map((reg) =>
    sumFacts(
      reg.id,
      reg.name,
      'region',
      facts.filter((f) => f.region_id === reg.id),
    ),
  );

  const coo = sumFacts('company', 'Recruit 619 (company)', 'coo', facts);

  return {
    recruiters,
    managers,
    locations: locationRows,
    regions: regionRows,
    coo,
  };
}
