/** Org spine — reports-to tree, visibility, Me/Team profile sets. */

export type OrgProfileNode = {
  id: string;
  email: string;
  full_name: string | null;
  job_title: string | null;
  role: string;
  entity_id: string | null;
  manager_profile_id: string | null;
  avatar_url: string | null;
  active: boolean;
};

export type OrgTreeNode = OrgProfileNode & {
  children: OrgTreeNode[];
};

export type EosViewMode = 'me' | 'team' | 'entity' | 'consolidated';

const FIRM_WIDE_ROLES = new Set([
  'visionary',
  'think_tank',
  'partner',
  'coo',
  'admin',
  'ssc_hr',
  'ssc_finance',
]);

export function canEditOrgSpine(role: string): boolean {
  return [
    'admin',
    'visionary',
    'think_tank',
    'coo',
    'ssc_hr',
    'partner',
  ].includes(role);
}

export function canViewHireImpact(role: string): boolean {
  return [
    'admin',
    'visionary',
    'think_tank',
    'coo',
    'partner',
    'ssc_hr',
    'ssc_finance',
    'sub_lead',
  ].includes(role);
}

/** Profiles the viewer may see in Org Chart / directory. */
export function filterProfilesForViewer(
  profiles: OrgProfileNode[],
  viewer: { id: string; role: string; entity_id: string | null },
  opts?: { entityScope?: string | null; consolidated?: boolean },
): OrgProfileNode[] {
  const active = profiles.filter((p) => p.active);
  if (opts?.consolidated || FIRM_WIDE_ROLES.has(viewer.role)) {
    if (opts?.entityScope) {
      return active.filter((p) => p.entity_id === opts.entityScope);
    }
    return active;
  }
  const home = viewer.entity_id;
  if (!home) return active.filter((p) => p.id === viewer.id);
  return active.filter(
    (p) => p.entity_id === home || p.id === viewer.id,
  );
}

export function buildOrgForest(
  profiles: OrgProfileNode[],
  rootId?: string | null,
): OrgTreeNode[] {
  const byId = new Map<string, OrgTreeNode>();
  for (const p of profiles) {
    byId.set(p.id, { ...p, children: [] });
  }

  const roots: OrgTreeNode[] = [];
  for (const node of byId.values()) {
    const mgr = node.manager_profile_id;
    if (mgr && byId.has(mgr) && mgr !== node.id) {
      byId.get(mgr)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRec = (nodes: OrgTreeNode[]) => {
    nodes.sort((a, b) =>
      (a.full_name || a.email).localeCompare(b.full_name || b.email),
    );
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);

  if (rootId && byId.has(rootId)) {
    return [byId.get(rootId)!];
  }
  return roots;
}

/** Self + all descendants along reports-to. */
export function collectSubtreeIds(
  profiles: OrgProfileNode[],
  rootId: string,
): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const p of profiles) {
    if (!p.manager_profile_id) continue;
    const list = childrenOf.get(p.manager_profile_id) ?? [];
    list.push(p.id);
    childrenOf.set(p.manager_profile_id, list);
  }
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const child of childrenOf.get(id) ?? []) {
      if (out.has(child)) continue;
      out.add(child);
      stack.push(child);
    }
  }
  return out;
}

/** Direct reports only (one level). */
export function collectDirectReportIds(
  profiles: OrgProfileNode[],
  managerId: string,
): Set<string> {
  return new Set(
    profiles
      .filter((p) => p.manager_profile_id === managerId && p.active)
      .map((p) => p.id),
  );
}

/**
 * Profile IDs whose EOS items (owner / assignee) should appear for a view mode.
 * - me: self
 * - team: self + direct reports
 * - entity / consolidated: null = no owner filter (all in entity scope)
 */
export function ownerIdsForEosView(
  mode: EosViewMode,
  profiles: OrgProfileNode[],
  viewerId: string,
): Set<string> | null {
  if (mode === 'entity' || mode === 'consolidated') return null;
  if (mode === 'me') return new Set([viewerId]);
  const direct = collectDirectReportIds(profiles, viewerId);
  direct.add(viewerId);
  return direct;
}

export function resolveDefaultEosViewMode(role: string): EosViewMode {
  if (role === 'visionary' || role === 'think_tank' || role === 'partner') {
    return 'consolidated';
  }
  if (role === 'coo' || role === 'admin' || role === 'ssc_hr') return 'entity';
  if (role === 'sub_lead') return 'entity';
  return 'me';

}

export function wouldCreateCycle(
  profiles: OrgProfileNode[],
  profileId: string,
  newManagerId: string | null,
): boolean {
  if (!newManagerId) return false;
  if (newManagerId === profileId) return true;
  const byId = new Map(profiles.map((p) => [p.id, p]));
  let cur: string | null = newManagerId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === profileId) return true;
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = byId.get(cur)?.manager_profile_id ?? null;
  }
  return false;
}
