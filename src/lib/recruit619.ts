/**
 * Recruit 619 (portfolio entity) ↔ TalentDesk (recruiter platform) integration.
 *
 * TalentDesk lives at app.recruit619.com — separate Next.js app, Auth.js credentials,
 * @recruit619.com allowlist. Portal SSO: short-lived HMAC JWT via talentdesk-sso edge
 * function (see src/lib/talentDeskSso.ts). Direct app.recruit619.com visits still use
 * normal email/password login.
 *
 * Recruiters / Managers tabs were removed from Manage Portfolio entity nav —
 * they live in Recruiting Desk. Use Platform tab SSO instead.
 */

/** Stable ops_entities.slug for the Recruit 619 portfolio company. */
export const RECRUIT_619_SLUG = 'recruit-619';

/** Production TalentDesk origin (leave live app undisturbed). */
export const TALENTDESK_ORIGIN =
  (import.meta.env.VITE_TALENTDESK_ORIGIN as string | undefined)?.replace(
    /\/$/,
    '',
  ) || 'https://app.recruit619.com';

export const TALENTDESK_PATHS = {
  login: '/login',
  /** Recruiter placement / go-to-market queue */
  placement: '/placement',
  placements: '/placements',
  performance: '/performance',
  search: '/search',
  /** Manager assignments + team KPI rollups */
  team: '/team',
  /** Recruiter → Manager → Location → Region → COO KPI rollups */
  hierarchy: '/hierarchy',
} as const;

export function talentDeskUrl(
  path: keyof typeof TALENTDESK_PATHS | (string & {}),
): string {
  const suffix =
    path in TALENTDESK_PATHS
      ? TALENTDESK_PATHS[path as keyof typeof TALENTDESK_PATHS]
      : path.startsWith('/')
        ? path
        : `/${path}`;
  return `${TALENTDESK_ORIGIN}${suffix}`;
}

export function isRecruit619Entity(entity: {
  slug?: string | null;
} | null): boolean {
  return entity?.slug === RECRUIT_619_SLUG;
}

/** @deprecated Use PortfolioEntitySection from portfolioEntity.ts */
export type Recruit619Section =
  | 'overview'
  | 'leadership'
  | 'think-tank'
  | 'financial'
  | 'kpis'
  | 'platform'
  | 'recruiters'
  | 'managers';

/** @deprecated Use PORTFOLIO_ENTITY_SECTIONS — recruiters/managers removed from nav. */
export const RECRUIT_619_SECTIONS: {
  id: Recruit619Section;
  label: string;
  pathSuffix: string;
}[] = [
  { id: 'overview', label: 'Overview', pathSuffix: '' },
  { id: 'leadership', label: 'Leadership', pathSuffix: '/leadership' },
  { id: 'think-tank', label: 'Think Tank', pathSuffix: '/think-tank' },
  { id: 'financial', label: 'Financial', pathSuffix: '/financial' },
  { id: 'kpis', label: 'KPIs', pathSuffix: '/kpis' },
  { id: 'platform', label: 'Platform', pathSuffix: '/platform' },
];

export function recruit619EntityPath(
  entityId: string,
  section: Recruit619Section = 'overview',
): string {
  const base = `/sales/ops/entities/${entityId}`;
  if (section === 'recruiters' || section === 'managers') {
    return `${base}/platform`;
  }
  const meta = RECRUIT_619_SECTIONS.find((s) => s.id === section);
  return meta?.pathSuffix ? `${base}${meta.pathSuffix}` : base;
}
