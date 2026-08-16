/**
 * Canonical staff job titles shown in portal (profiles.job_title / HRIS role_title).
 * Spelling is intentional — Principal (not Principle).
 */

export const LAUREN_MONROE_EMAIL = 'lauren@tagevc.com';

/** Lauren Monroe — displayed title across org / profile / HRIS. */
export const LAUREN_MONROE_JOB_TITLE = 'Principal Strategist';

export function isLaurenMonroeEmail(
  email: string | null | undefined,
): boolean {
  return (email ?? '').trim().toLowerCase() === LAUREN_MONROE_EMAIL;
}

/** Josh Monroe mailbox emails (Tage + Recruit 619). */
export const JOSH_MONROE_EMAILS = [
  'joshmonroe@tagevc.com',
  'joshmonroe@recruit619.com',
] as const;

/** Josh Monroe — Founder / CEO on branded signatures + profile display. */
export const JOSH_MONROE_JOB_TITLE = 'Founder / CEO';

export function isJoshMonroeEmail(
  email: string | null | undefined,
): boolean {
  const needle = (email ?? '').trim().toLowerCase();
  return (JOSH_MONROE_EMAILS as readonly string[]).includes(needle);
}

/**
 * Prefer a known per-email staff title; otherwise the caller-supplied title.
 */
export function staffJobTitleForEmail(
  email: string | null | undefined,
  fallbackTitle?: string | null,
): string | null {
  if (isJoshMonroeEmail(email)) return JOSH_MONROE_JOB_TITLE;
  if (isLaurenMonroeEmail(email)) return LAUREN_MONROE_JOB_TITLE;
  const trimmed = (fallbackTitle ?? '').trim();
  return trimmed || null;
}
