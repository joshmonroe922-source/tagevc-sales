/**
 * Phase 73 — Net Worth / I-quadrant visibility + permission matrix.
 */

import { isVisionaryBreadthRole, type AppRole } from '@/lib/types/roles';

export const NET_WORTH_CONTRACT_VERSION = 'phase73-v1' as const;

export type AssetVisibilityScope = 'visionary_private' | 'firm_visible';

export type InvestorAssetClass =
  | 'brokerage'
  | 'retirement'
  | 'stock_fund'
  | 'crypto'
  | 'private_other'
  | 'business_equity'
  | 'real_estate'
  | 'firm_cash'
  | 'firm_other';

export type InvestorAssetSource = 'manual' | 'csv' | 'connector' | 'derived';

export const PRIVATE_I_QUADRANT_CLASSES: readonly InvestorAssetClass[] = [
  'brokerage',
  'retirement',
  'stock_fund',
  'crypto',
  'private_other',
] as const;

export const FIRM_VISIBLE_CLASSES: readonly InvestorAssetClass[] = [
  'business_equity',
  'real_estate',
  'firm_cash',
  'firm_other',
] as const;

/** Roles that may view/edit business credit (not Partner by default; not Think Tank). */
export const BUSINESS_CREDIT_ROLES: readonly AppRole[] = [
  'visionary',
  'admin',
  'service_lead',
  'counsel_ops',
  'coo',
  'ssc_finance',
] as const;

export function defaultVisibilityForClass(
  assetClass: InvestorAssetClass,
): AssetVisibilityScope {
  if ((PRIVATE_I_QUADRANT_CLASSES as readonly string[]).includes(assetClass)) {
    return 'visionary_private';
  }
  return 'firm_visible';
}

export function isPrivateIQuadrantClass(assetClass: InvestorAssetClass): boolean {
  return (PRIVATE_I_QUADRANT_CLASSES as readonly string[]).includes(assetClass);
}

/** Full Net Worth page — Visionary or Think Tank; blocked during Live Look. */
export function canAccessNetWorthPage(input: {
  realRole: AppRole;
  liveLookActive?: boolean;
}): boolean {
  if (input.liveLookActive) return false;
  return isVisionaryBreadthRole(input.realRole);
}

/**
 * Investments page (retirement / stocks / crypto) — same Visionary-breadth gate
 * as Net Worth; blocked during Live Look.
 */
export function canAccessInvestmentsPage(input: {
  realRole: AppRole;
  liveLookActive?: boolean;
}): boolean {
  return canAccessNetWorthPage(input);
}

/** Private investments / crypto / retirement detail. */
export function canViewPrivateIQuadrant(input: {
  realRole: AppRole;
  liveLookActive?: boolean;
}): boolean {
  return canAccessInvestmentsPage(input);
}

/** Personal bureau / scores / disputes — Visionary only (not Think Tank). */
export function canViewPersonalCredit(input: {
  realRole: AppRole;
  liveLookActive?: boolean;
}): boolean {
  if (input.liveLookActive) return false;
  return input.realRole === 'visionary';
}

export function canViewBusinessCredit(role: AppRole): boolean {
  return (BUSINESS_CREDIT_ROLES as readonly string[]).includes(role);
}

/**
 * Credit Management UI (personal + business credit hub).
 * Explicitly excluded for Think Tank (effective or real).
 */
export function canAccessCreditManagement(input: {
  role: AppRole;
  realRole: AppRole;
  liveLookActive?: boolean;
}): boolean {
  if (input.liveLookActive) return false;
  if (input.role === 'think_tank' || input.realRole === 'think_tank') {
    return false;
  }
  return (
    canViewPersonalCredit({
      realRole: input.realRole,
      liveLookActive: false,
    }) || canViewBusinessCredit(input.role)
  );
}

/**
 * Firm AUM for non-Visionary dashboards: firm_visible only.
 * Visionary may optionally include private when building Net Worth (not Firm AUM).
 */
export function filterAssetsForFirmAum<
  T extends { visibility_scope: AssetVisibilityScope; asset_class: InvestorAssetClass },
>(assets: T[]): T[] {
  return assets.filter(
    (a) =>
      a.visibility_scope === 'firm_visible' &&
      !isPrivateIQuadrantClass(a.asset_class),
  );
}

export function assetClassLabel(assetClass: InvestorAssetClass): string {
  const map: Record<InvestorAssetClass, string> = {
    brokerage: 'Investments (brokerage)',
    retirement: 'Retirement',
    stock_fund: 'Stocks / funds',
    crypto: 'Crypto',
    private_other: 'Other private',
    business_equity: 'Business / portfolio',
    real_estate: 'Real estate',
    firm_cash: 'Firm cash',
    firm_other: 'Other firm assets',
  };
  return map[assetClass];
}

export function breakdownBucket(
  assetClass: InvestorAssetClass,
):
  | 'investments'
  | 'crypto'
  | 'retirement'
  | 'business'
  | 'real_estate'
  | 'firm_other' {
  if (assetClass === 'crypto') return 'crypto';
  if (assetClass === 'retirement') return 'retirement';
  if (assetClass === 'brokerage' || assetClass === 'stock_fund' || assetClass === 'private_other') {
    return 'investments';
  }
  if (assetClass === 'business_equity') return 'business';
  if (assetClass === 'real_estate') return 'real_estate';
  return 'firm_other';
}
