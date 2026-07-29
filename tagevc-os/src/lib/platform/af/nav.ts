/**
 * Build entity-branded A&F nav trees for Tage + subsidiary OS spines.
 * Scaffold only — wire role gates in each portal's nav filter.
 */

import {
  AF_HUB_PATH,
  AF_SECTIONS,
  afHubLabel,
  type AfSection,
} from '@/lib/platform/af/sections';

export type AfNavLeaf = {
  href: string;
  label: string;
  description: string;
};

export type AfNavBranch = AfNavLeaf & {
  children: AfNavLeaf[];
};

/** Hub + four section siblings (nested accordion shape used by Tage). */
export function buildAfNavBranch(entityDisplayName: string): AfNavBranch {
  return {
    href: AF_HUB_PATH,
    label: afHubLabel(entityDisplayName),
    description: 'In-portal A&F · audit · controls (scaffold)',
    children: AF_SECTIONS.map((s) => ({
      href: s.path,
      label: s.label,
      description: s.description,
    })),
  };
}

/** Flat list: hub then four sections (Instant NDA / Signent flat MAIN_NAV). */
export function buildAfNavFlat(entityDisplayName: string): AfNavLeaf[] {
  const branch = buildAfNavBranch(entityDisplayName);
  return [branch, ...branch.children];
}

/** Section rows for Recruit 619-style NAV_SECTIONS. */
export function buildAfNavSectionItems(
  entityDisplayName: string,
): { hub: AfNavLeaf; sections: AfSection[] } {
  return {
    hub: {
      href: AF_HUB_PATH,
      label: afHubLabel(entityDisplayName),
      description: 'Accounting · Finance · Audit · Controls (scaffold)',
    },
    sections: [...AF_SECTIONS],
  };
}
