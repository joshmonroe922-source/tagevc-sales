/**
 * Role-aware nav filtering (impersonation / Live Look effective role).
 *
 * - COO: `hiddenForRoles` hides Command Center / Firm / BD; Assets keeps
 *   Businesses + Real Estate (Investments / Net Worth are Visionary-only).
 * - Subsidiary Leader: NO multi-company Assets — single top-level nav entry
 *   labeled with their led entity (e.g. "Recruit 619") → company overview.
 *   C-Suite + Command Center stay hidden. Assignment lists stay single-company.
 * - Associate / VC Sourcer: C-Suite + Command Center + Firm + Assets hidden;
 *   BD keeps accordion with VC Sourcing (`/deal-flow/vc`) + M&A Sourcing
 *   (`/deal-flow/ma`). Lands on VC sourcing (not portfolio companies).
 * - M&A Associate: C-Suite + Command Center + Firm hidden; BD collapses to
 *   top-level "M&A Activities" → `/deal-flow/ma` (owner-assigned targets).
 * - Sourcer (re_sourcer): C-Suite + Command Center + Firm hidden; BD
 *   collapses to top-level "Sourcing Platform" → `/deal-flow/re`
 *   (sourcer-assigned RE leads through completion/handoff).
 * - SSC operators: MAIN_NAV `hiddenForRoles` hides C-Suite / BD / Command
 *   Center / Assets / Firm; function children scoped (Counsel/Ops → Legal;
 *   Service Lead → led desk only, Finance default; ssc_* → own home).
 * - Admin: hides C-Suite / BD / Command Center / Assets / Firm; keeps
 *   Dashboard (ops KPIs), Shared Services → Ticket Portal / Admin
 *   (Document Library + DocuSign nested under Admin), Message Center.
 *   Help Desk is via Create Ticket dropdown (not left nav). To Do List
 *   (`/to-do`) is left-nav for operator work (not tickets). Lands on `/dashboard`.
 * - `visionaryOnly` follows the *effective* role so Role Switcher hides
 *   C-Suite / Investments / Net Worth when viewing as COO, SSC, or sub_lead.
 * - IA note: Assets stays under Home (not under Dashboard). BD stays top-level
 *   (not under Assets) so associate / sourcer transforms keep working.
 */

import {
  resolveSubsidiaryLeaderEntityId,
} from '@/lib/entities/assignment-lead';
import { entityDisplayName } from '@/lib/entities/display-name';
import type { NavItem } from '@/lib/nav';
import {
  roleCanAccessModule,
  roleHasPermission,
  type AppRole,
} from '@/lib/types/roles';

export type NavFilterContext = {
  role: AppRole;
  realRole: AppRole;
  liveLookActive?: boolean;
  /** Effective profile entity id — drives Subsidiary Leader nav label. */
  entityId?: string | null;
};

export function filterNavForRole(
  items: NavItem[],
  ctx: NavFilterContext,
): NavItem[] {
  const { role, liveLookActive = false } = ctx;
  const out: NavItem[] = [];
  for (const item of items) {
    // Effective role so Role Switcher / Live Look match annotated persona view.
    if (item.visionaryOnly && role !== 'visionary') continue;
    if (item.hideDuringLiveLook && liveLookActive) continue;
    if (item.hiddenForRoles?.includes(role)) continue;

    // Children first — Shared Services / Admin host mixed modules (docs, DocuSign).
    const filteredChildren = item.children
      ? filterNavForRole(item.children, ctx)
      : undefined;
    const hasVisibleChildren = Boolean(filteredChildren?.length);
    // Omit empty arrays so hybrid parents (e.g. IT) don't show a dead chevron
    // when all children (Activity / Visionary Audit) are filtered out.
    const children = hasVisibleChildren ? filteredChildren : undefined;

    if (!item.href && hasVisibleChildren) {
      out.push({ ...item, children });
      continue;
    }

    const canAccessParent = roleCanAccessModule(role, item.module);
    if (
      item.requiredPermission &&
      !roleHasPermission(role, item.requiredPermission)
    ) {
      continue;
    }

    // Hybrid parent (e.g. Admin → Document Library): keep accordion + children
    // when the user cannot open the parent module but can see nested items.
    if (item.href && hasVisibleChildren && !canAccessParent) {
      out.push({ ...item, href: undefined, children });
      continue;
    }

    if (!canAccessParent) continue;
    if (!item.href && !hasVisibleChildren) continue;
    out.push({ ...item, children });
  }

  return applyRoleNavTransforms(out, ctx);
}

/** True for the multi-company Assets / Portfolio accordion (not Dashboard). */
export function isMultiCompanyAssetsNavItem(item: NavItem): boolean {
  if (item.label === 'Assets' || item.label === 'Portfolio') return true;
  return (
    item.module === 'portfolio' &&
    !!item.children?.length &&
    item.href !== '/dashboard' &&
    !item.href?.startsWith('/entities/')
  );
}

/** Role-specific nav shape transforms (sub_lead, associate, ma_associate, re_sourcer). */
export function applyRoleNavTransforms(
  items: NavItem[],
  ctx: NavFilterContext,
): NavItem[] {
  if (ctx.role === 'sub_lead') {
    const ledId = resolveSubsidiaryLeaderEntityId(ctx.entityId);
    const ledName = entityDisplayName(ledId);
    return items.map((item) => {
      if (!isMultiCompanyAssetsNavItem(item)) return item;
      return {
        module: 'portfolio',
        href: `/entities/${ledId}`,
        label: ledName,
        description: 'Your company overview',
      };
    });
  }

  if (ctx.role === 'associate') {
    return items.map((item) => {
      if (item.label !== 'Business Development') return item;
      return {
        module: 'deal_flow_vc',
        label: 'Business Development',
        description: 'VC and M&A deal sourcing',
        children: [
          {
            module: 'deal_flow_vc',
            href: '/deal-flow/vc',
            label: 'VC Sourcing',
            description: 'Venture pipeline and lead sourcing',
          },
          {
            module: 'deal_flow_ma',
            href: '/deal-flow/ma',
            label: 'M&A Sourcing',
            description: 'M&A targets and deal pipeline',
          },
        ],
      };
    });
  }

  if (ctx.role === 'ma_associate') {
    return items.map((item) => {
      if (item.label !== 'Business Development') return item;
      return {
        module: 'deal_flow_ma',
        href: '/deal-flow/ma',
        label: 'M&A Activities',
        description: 'Pipeline projects assigned to you',
      };
    });
  }

  if (ctx.role === 're_sourcer') {
    return items.map((item) => {
      if (item.label !== 'Business Development') return item;
      return {
        module: 'deal_flow_re',
        href: '/deal-flow/re',
        label: 'Sourcing Platform',
        description: 'RE leads assigned to you through handoff',
      };
    });
  }

  return items;
}
