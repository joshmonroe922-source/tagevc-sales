/**
 * Pure hierarchy suggestion rules — unit-testable (T07/T08).
 */

export type HierarchyNode = {
  id: string;
  full_name: string;
  title: string | null;
};

export type ExistingEdge = {
  manager_contact_id: string;
  report_contact_id: string;
  status: 'suggested' | 'confirmed' | 'rejected' | string;
};

export function titleSeniorityRank(title: string | null): number {
  const t = (title || '').toLowerCase();
  if (/\b(ceo|founder|president|partner)\b/.test(t)) return 100;
  if (/\b(coo|cfo|cto|chro|chief)\b/.test(t)) return 90;
  if (/\bvp\b|vice president/.test(t)) return 80;
  if (/\bdirector\b/.test(t)) return 60;
  if (/\bmanager\b|head of/.test(t)) return 40;
  return 20;
}

export type ProposedEdge = {
  manager_contact_id: string;
  report_contact_id: string;
  confidence: number;
  rationale: string;
};

/**
 * Propose reports_to edges from title bands.
 * Never proposes pairs already suggested|confirmed|rejected (T08).
 * Never overwrites confirmed (caller must not update those rows).
 */
export function proposeHierarchyEdges(
  nodes: HierarchyNode[],
  existing: ExistingEdge[],
): ProposedEdge[] {
  if (nodes.length < 2) return [];
  const sorted = [...nodes].sort(
    (a, b) => titleSeniorityRank(b.title) - titleSeniorityRank(a.title),
  );
  const top = sorted[0];
  const blocked = new Set(
    existing.map((e) => `${e.manager_contact_id}:${e.report_contact_id}`),
  );
  const out: ProposedEdge[] = [];
  for (const n of sorted.slice(1)) {
    if (titleSeniorityRank(n.title) >= titleSeniorityRank(top.title)) continue;
    const key = `${top.id}:${n.id}`;
    if (blocked.has(key)) continue;
    out.push({
      manager_contact_id: top.id,
      report_contact_id: n.id,
      confidence: 0.55,
      rationale: `Rule: ${n.title || 'IC'} reports to highest band (${top.title})`,
    });
  }
  return out;
}

/** Roll employment on job change (T17). */
export function nextEmploymentState(input: {
  priorCurrent: { id: string; account_id: string }[];
  newAccountId: string;
  at: string;
}): {
  endIds: string[];
  start: { account_id: string; is_current: true; started_at: string };
} {
  return {
    endIds: input.priorCurrent.map((e) => e.id),
    start: {
      account_id: input.newAccountId,
      is_current: true,
      started_at: input.at,
    },
  };
}
