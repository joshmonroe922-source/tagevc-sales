import { activePortalForPath, getPortalDefinition } from './portals';
import type { SalesUser } from './types';
import { getLead } from './api';

export type TodoCaptureContext = {
  path: string;
  label: string;
  leadId: string | null;
  dealName: string | null;
  dealUrl: string | null;
};

const GLOBAL_LABELS: Array<{ prefix: string; label: string }> = [
  { prefix: '/sales/mail', label: 'Email' },
  { prefix: '/sales/tickets', label: 'Tickets' },
  { prefix: '/sales/calendar', label: 'Calendar' },
  { prefix: '/sales/todo', label: 'To Do' },
  { prefix: '/sales/to-do', label: 'To Do' },
  { prefix: '/sales/planner', label: 'Planner' },
  { prefix: '/sales/chat', label: 'Teams chat' },
  { prefix: '/sales/meetings', label: 'Teams Meetings' },
  { prefix: '/sales/files', label: 'Files' },
  { prefix: '/sales/admin/email', label: 'Email Analytics' },
  { prefix: '/sales/admin/portals', label: 'Assignments' },
  { prefix: '/sales/admin/audit', label: 'Audit log' },
  { prefix: '/sales/admin/tickets', label: 'Admin tickets' },
  // Trailing slash avoids matching `/sales/administrative`.
  { prefix: '/sales/admin/', label: 'Admin' },
];

const DEAL_DETAIL_RE = /^\/sales\/(?:deal-sourcing\/)?leads\/([^/]+)\/?$/;

export function dealIdFromPath(pathname: string): string | null {
  const m = pathname.match(DEAL_DETAIL_RE);
  return m?.[1] ?? null;
}

/** Human label for the current sales route (portal or global tool). */
export function todoPageLabel(
  pathname: string,
  search: string,
  salesUser: SalesUser,
): string {
  if (pathname === '/sales' || pathname === '/sales/') return 'Portals';

  if (pathname.startsWith('/sales/deal-sourcing/tasks') || pathname.startsWith('/sales/tasks')) {
    return 'Deal tasks';
  }
  if (
    pathname.startsWith('/sales/deal-sourcing/automation') ||
    pathname.startsWith('/sales/automation')
  ) {
    return 'Nurture';
  }
  if (
    pathname.startsWith('/sales/deal-sourcing/leads') ||
    pathname.startsWith('/sales/leads') ||
    dealIdFromPath(pathname)
  ) {
    return 'Deal Sourcing';
  }
  if (pathname.startsWith('/sales/content/blog')) return 'Blog';
  if (pathname.startsWith('/sales/content/social')) return 'Social';
  if (pathname.startsWith('/sales/content')) return 'Content hub';
  if (pathname.startsWith('/sales/marketing')) return 'Marketing';
  if (pathname.startsWith('/sales/ops')) return 'Manage Portfolio';
  if (pathname.startsWith('/sales/legal')) return 'Legal';
  if (pathname.startsWith('/sales/finance')) return 'Finance';
  if (pathname.startsWith('/sales/hr')) return 'Human Resources';
  if (pathname.startsWith('/sales/administrative')) return 'Administrative';
  if (pathname.startsWith('/sales/reports')) return 'Reporting';
  if (pathname.startsWith('/sales/due-diligence')) return 'Due Diligence';

  for (const g of GLOBAL_LABELS) {
    if (pathname.startsWith(g.prefix)) return g.label;
  }

  const slug = activePortalForPath(pathname, search, salesUser);
  if (slug) {
    const def = getPortalDefinition(slug);
    if (def) return def.name;
  }

  return 'Workspace';
}

export function formatTodoContextBody(ctx: TodoCaptureContext): string {
  const lines = [`Context: ${ctx.label}`, `Path: ${ctx.path}`];
  if (ctx.dealName) {
    lines.push(`Deal: ${ctx.dealName}`);
  }
  if (ctx.dealUrl) {
    lines.push(`Open: ${ctx.dealUrl}`);
  }
  return lines.join('\n');
}

const DEAL_URL_IN_BODY_RE =
  /\/sales\/(?:deal-sourcing\/)?leads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\w[\w-]{6,})/i;

/** Recover “Open deal” from stamped To Do body when sales_tasks link is missing. */
export function dealLinkFromTodoBody(
  bodyPreview: string | null | undefined,
): { lead_id: string; label: string } | null {
  if (!bodyPreview?.trim()) return null;
  const m = bodyPreview.match(DEAL_URL_IN_BODY_RE);
  if (!m?.[1]) return null;
  const dealLine = bodyPreview.match(/^Deal:\s*(.+)$/im);
  return {
    lead_id: m[1],
    label: dealLine?.[1]?.trim() || 'Open deal',
  };
}

/** Resolve capture context for the header Add To Do modal (includes deal name when on a card). */
export async function resolveTodoCaptureContext(
  pathname: string,
  search: string,
  salesUser: SalesUser,
  origin?: string,
  dealPrefill?: { leadId: string; dealName: string } | null,
): Promise<TodoCaptureContext> {
  const path = `${pathname}${search || ''}`;
  const label = todoPageLabel(pathname, search, salesUser);
  const base = (origin ?? (typeof window !== 'undefined' ? window.location.origin : '')).replace(
    /\/$/,
    '',
  );

  if (dealPrefill?.leadId) {
    return {
      path,
      label,
      leadId: dealPrefill.leadId,
      dealName: dealPrefill.dealName,
      dealUrl: `${base}/sales/deal-sourcing/leads/${dealPrefill.leadId}`,
    };
  }

  const leadId = dealIdFromPath(pathname);
  const dealUrl = leadId ? `${base}/sales/deal-sourcing/leads/${leadId}` : null;

  let dealName: string | null = null;
  if (leadId) {
    try {
      const lead = await getLead(leadId);
      if (lead) {
        dealName = lead.company ? `${lead.name} · ${lead.company}` : lead.name;
      }
    } catch {
      dealName = null;
    }
  }

  return {
    path,
    label,
    leadId,
    dealName,
    dealUrl,
  };
}
