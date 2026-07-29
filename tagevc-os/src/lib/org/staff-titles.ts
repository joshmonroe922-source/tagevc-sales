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
