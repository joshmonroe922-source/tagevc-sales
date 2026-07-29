/**
 * IES connection / refresh UX helpers.
 *
 * Live P&L in OS uses native synced snapshots (primary). Intuit does not
 * reliably allow iframe embed of QBO/IES P&L reports — use Open in IES
 * deep links when a company is mapped, never invent numbers.
 */

import { canViewLivePnl } from '@/lib/dashboard/pnl-visibility';
import { resolveIesCompanyByEntity } from '@/lib/ies/company-map';
import {
  roleHasPermission,
  type AppRole,
  type Permission,
} from '@/lib/types/roles';

/** Manage OAuth connect / map — existing finance write gate. */
export const IES_CONNECT_PERMISSION: Permission = 'write:shared_services';

export function canManageIesConnections(role: AppRole): boolean {
  return roleHasPermission(role, IES_CONNECT_PERMISSION);
}

/**
 * Refresh (global sync) for anyone who can read finance/P&L for a scope:
 * live P&L roles + Shared Services readers (Partner, SSC desks, etc.).
 */
export function canRefreshIesSnapshots(role: AppRole): boolean {
  return (
    canViewLivePnl(role) ||
    roleHasPermission(role, 'read:shared_services')
  );
}

/** Start OAuth for a specific OS entity (Finance/IES map). */
export function iesConnectHref(entityId?: string | null): string {
  const id = entityId?.trim();
  return id
    ? `/api/finance/ies/oauth?entity=${encodeURIComponent(id)}`
    : '/api/finance/ies/oauth';
}

/**
 * Best-effort Open in QuickBooks / IES books.
 * Intuit does not support stable iframe embed of P&L; product deep links are
 * session-based and company selection may follow the user's last IES company.
 */
export function iesOpenInBooksHref(entityId?: string | null): string | null {
  const mapped = entityId?.trim()
    ? resolveIesCompanyByEntity(entityId.trim())
    : undefined;
  if (!mapped) {
    // Consolidated / unknown — open QBO home (user picks company in IES).
    return 'https://app.qbo.intuit.com/app/homepage';
  }
  return `https://app.qbo.intuit.com/app/report?rptId=ProfitAndLoss&companyId=${encodeURIComponent(mapped.ies_company_id)}`;
}

export function formatIesLastSynced(
  iso: string | null | undefined,
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

/** Honest product note for UI / docs. */
export const IES_EMBED_POLICY =
  'Intuit does not reliably allow full iframe embed of P&L. Tage shows native synced snapshots in OS and offers Open in IES / QuickBooks when a company is mapped.';
