/**
 * My Recruiting Desk (formerly Talent Desk) — day-to-day recruiter experience.
 * Primary UX now lives on portal.recruit619.com (desk home). Legacy
 * app.recruit619.com remains live temporarily during cutover. OS spine
 * (messaging, help desk, rollups) stays on portal / Tage entity OS.
 */

export const MY_RECRUITING_DESK_ORIGIN = (
  process.env.NEXT_PUBLIC_MY_RECRUITING_DESK_URL?.trim() ||
  process.env.MY_RECRUITING_DESK_URL?.trim() ||
  process.env.NEXT_PUBLIC_RECRUIT_PORTAL_URL?.trim() ||
  process.env.RECRUIT_PORTAL_URL?.trim() ||
  'https://portal.recruit619.com'
).replace(/\/$/, '');

export const RECRUIT_PORTAL_ORIGIN = (
  process.env.NEXT_PUBLIC_RECRUIT_PORTAL_URL?.trim() ||
  process.env.RECRUIT_PORTAL_URL?.trim() ||
  'https://portal.recruit619.com'
).replace(/\/$/, '');

export const MY_RECRUITING_DESK_PATHS = {
  home: '/desk/my-recruiting-desk',
  login: '/login',
  placement: '/desk/placement',
  placements: '/desk/placement',
  performance: '/desk/performance',
  hierarchy: '/desk/hierarchy',
  bulkEmail: '/desk/bulk-email',
  training: '/desk/training',
  thinkTank: '/think-tank',
  search: '/people',
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
