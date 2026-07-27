/**
 * My Recruiting Desk (formerly Talent Desk) — day-to-day recruiter experience.
 * Live at app.recruit619.com. R619 OS spine stays on portal.recruit619.com /
 * Tage entity OS; desk ↔ spine flow both ways.
 */

export const MY_RECRUITING_DESK_ORIGIN = (
  process.env.NEXT_PUBLIC_MY_RECRUITING_DESK_URL?.trim() ||
  process.env.MY_RECRUITING_DESK_URL?.trim() ||
  'https://app.recruit619.com'
).replace(/\/$/, '');

export const RECRUIT_PORTAL_ORIGIN = (
  process.env.NEXT_PUBLIC_RECRUIT_PORTAL_URL?.trim() ||
  process.env.RECRUIT_PORTAL_URL?.trim() ||
  'https://portal.recruit619.com'
).replace(/\/$/, '');

export const MY_RECRUITING_DESK_PATHS = {
  home: '/',
  login: '/login',
  placement: '/placement',
  placements: '/placements',
  performance: '/performance',
  hierarchy: '/hierarchy',
  bulkEmail: '/bulk-email',
  training: '/training',
  thinkTank: '/think-tank',
  search: '/search',
  team: '/team',
} as const;

export function myRecruitingDeskUrl(
  path: keyof typeof MY_RECRUITING_DESK_PATHS | (string & {}) = 'home',
): string {
  const suffix =
    path in MY_RECRUITING_DESK_PATHS
      ? MY_RECRUITING_DESK_PATHS[path as keyof typeof MY_RECRUITING_DESK_PATHS]
      : path.startsWith('/')
        ? path
        : `/${path}`;
  return `${MY_RECRUITING_DESK_ORIGIN}${suffix}`;
}

export function recruitPortalUrl(path = '/'): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${RECRUIT_PORTAL_ORIGIN}${suffix}`;
}

export function isRecruit619EntityId(entityId: string | null | undefined): boolean {
  return (entityId ?? '').trim() === 'ENT-R619';
}
