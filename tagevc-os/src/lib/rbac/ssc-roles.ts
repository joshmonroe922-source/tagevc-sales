/**
 * Shared Services Center (SSC) function roles — Role Switcher + nav scope.
 * Counsel/Ops maps to Legal; each ssc_* role lands in its function home.
 * Service Lead is one-function scoped (led desk only) — not firm-wide SSC.
 */

import type { AppRole } from '@/lib/types/roles';

export const SSC_FUNCTION_ROLES = [
  'ssc_finance',
  'ssc_hr',
  'ssc_legal',
  'ssc_it',
  'ssc_marketing',
] as const;

export type SscFunctionRole = (typeof SSC_FUNCTION_ROLES)[number];

export type SscNavFunctionLabel =
  | 'Finance'
  | 'HR'
  | 'IT'
  | 'Marketing'
  | 'Legal';

/**
 * Demo / Role Switcher default when Visionary views as generic Service Lead.
 * Use the dedicated ssc_* roles to view other desks.
 */
export const DEFAULT_SERVICE_LEAD_FUNCTION: SscNavFunctionLabel = 'Finance';

/** One-function operators (includes Counsel/Ops → Legal, Service Lead → led desk). */
export const SSC_SCOPED_ROLES = [
  ...SSC_FUNCTION_ROLES,
  'counsel_ops',
  'service_lead',
] as const;

/** SSC operators: hide firm-wide C-Suite / BD / Command Center / Assets / Firm. */
export const SSC_OPERATOR_ROLES = [...SSC_SCOPED_ROLES] as const;

export const SSC_ROLE_PRIMARY_NAV_LABEL: Partial<
  Record<AppRole, SscNavFunctionLabel>
> = {
  ssc_finance: 'Finance',
  ssc_hr: 'HR',
  ssc_it: 'IT',
  ssc_marketing: 'Marketing',
  ssc_legal: 'Legal',
  counsel_ops: 'Legal',
  /** Generic Service Lead → led function only (Finance default for switcher). */
  service_lead: DEFAULT_SERVICE_LEAD_FUNCTION,
};

export const SSC_ROLE_LANDING: Partial<Record<AppRole, string>> = {
  ssc_finance: '/shared-services/af/finance',
  ssc_hr: '/shared-services/hr',
  ssc_it: '/shared-services/it/assets',
  ssc_marketing: '/shared-services/marketing',
  ssc_legal: '/shared-services/legal',
  counsel_ops: '/shared-services/legal',
  service_lead: '/shared-services/af/finance',
};

export function isSscOperatorRole(role: AppRole): boolean {
  return (SSC_OPERATOR_ROLES as readonly string[]).includes(role);
}

export function isSscScopedRole(role: AppRole): boolean {
  return (SSC_SCOPED_ROLES as readonly string[]).includes(role);
}

/** Scoped SSC roles that should not see the given function nav item. */
export function sscRolesHiddenFromFunction(
  keep: SscNavFunctionLabel,
): AppRole[] {
  return SSC_SCOPED_ROLES.filter((role) => {
    const primary = SSC_ROLE_PRIMARY_NAV_LABEL[role];
    return primary !== keep;
  });
}

/** Non-SSC landings (Role Switcher / first paint). */
const DESK_ROLE_LANDING: Partial<Record<AppRole, string>> = {
  /** Think Tank — Tage Venture Capital home (firm-wide). */
  think_tank: '/home',
  /** Associate / VC Sourcer — BD sourcing, not portfolio companies. */
  associate: '/deal-flow/vc',
  ma_associate: '/deal-flow/ma',
  re_sourcer: '/deal-flow/re',
  /** Admin — ops / access KPI dashboard (not Visionary firm KPIs). */
  admin: '/dashboard',
};

export function landingPathForRole(
  role: AppRole | null | undefined,
): string | null {
  if (!role) return null;
  return SSC_ROLE_LANDING[role] ?? DESK_ROLE_LANDING[role] ?? null;
}
