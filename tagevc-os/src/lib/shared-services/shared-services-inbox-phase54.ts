import {
  getSsHubCardModules,
  type SsHubModule,
} from '@/lib/shared-services/modules';
import { entityIdsEquivalent } from '@/lib/multi-sub/entity-registry';
import type { SsService, Ticket } from '@/lib/types';

export const PHASE54_SS_INBOX_CONTRACT_VERSION = 'phase54-v1';
export const PHASE54_ENTITY_FILTER_HINT = 'ENT-R619';

export type SsInboxSlaStatus =
  | 'ok'
  | 'due_soon'
  | 'breached'
  | 'none'
  | 'escalated';

export type SsInboxFeedStatus = 'ok' | 'partial' | 'missing' | 'unknown';

export type SsInboxModuleStub = {
  service: SsService;
  href: string;
  status: 'live' | 'foundation' | 'planned';
  todo: string | null;
};

export type SsInboxEscalation = {
  escalation_id?: string;
  ticket_id: string;
  entity_id: string | null;
  service: SsService | string;
  priority: string | null;
  sla_status: string;
  owner_name: string | null;
  severity: string;
  created_at: string;
};

export type SsInboxRelatedLink = {
  label: string;
  href: string;
  kind: 'ticket' | 'entity' | 'module' | 'document' | 'external';
};

export type SsInboxRow = {
  ticket: Ticket;
  sla_status: SsInboxSlaStatus;
  escalated: boolean;
  owner: string;
  related: SsInboxRelatedLink[];
  module_href: string | null;
  module_todo: string | null;
};

export type SharedServicesInboxPhase54Report = {
  entity_id: string | null;
  service_filter: string | null;
  open_total: number;
  by_service: Record<string, number>;
  by_sla_status: Record<string, number>;
  by_entity: Record<string, number>;
  escalated_count: number;
  breached_count: number;
  due_soon_count: number;
  unassigned_count: number;
  feed_status: SsInboxFeedStatus;
  snapshot_id: string | null;
  captured_at: string | null;
  recent_escalations: SsInboxEscalation[];
  recent_alerts: Array<Record<string, unknown>>;
  module_stubs: SsInboxModuleStub[];
  entity_filter_hint: string;
  todo: string;
  money_auto_approve: false;
  contract_version: typeof PHASE54_SS_INBOX_CONTRACT_VERSION;
};

const DEFAULT_MODULE_STUBS: SsInboxModuleStub[] = [
  {
    service: 'Finance',
    href: '/shared-services?service=Finance',
    status: 'planned',
    // TODO: Phase 55 Finance control plane
    todo: 'Phase 55 Finance control plane — dedicated Finance page not yet live',
  },
  {
    service: 'HR',
    href: '/shared-services?service=HR',
    status: 'planned',
    // TODO: Phase 57 HR production hardening
    todo: 'Phase 57 HR production hardening — dedicated HR page not yet live',
  },
  {
    service: 'Legal',
    href: '/shared-services/legal/docusign',
    status: 'live',
    todo: null,
  },
  {
    service: 'IT',
    href: '/shared-services/it/assets',
    status: 'live',
    todo: null,
  },
  {
    service: 'Marketing',
    href: '/shared-services/marketing',
    status: 'foundation',
    todo: null,
  },
];

export function emptySharedServicesInboxPhase54Report(
  entityId: string | null = null,
  serviceFilter: string | null = null,
): SharedServicesInboxPhase54Report {
  return {
    entity_id: entityId,
    service_filter: serviceFilter,
    open_total: 0,
    by_service: {},
    by_sla_status: { breached: 0, due_soon: 0, ok: 0 },
    by_entity: {},
    escalated_count: 0,
    breached_count: 0,
    due_soon_count: 0,
    unassigned_count: 0,
    feed_status: 'missing',
    snapshot_id: null,
    captured_at: null,
    recent_escalations: [],
    recent_alerts: [],
    module_stubs: DEFAULT_MODULE_STUBS,
    entity_filter_hint: PHASE54_ENTITY_FILTER_HINT,
    // TODO: Refresh board from os_tickets; Finance/HR pages pending Phase 55/57.
    todo: 'Refresh inbox board from os_tickets; Finance/HR module pages are stubs until Phase 55/57',
    money_auto_approve: false,
    contract_version: PHASE54_SS_INBOX_CONTRACT_VERSION,
  };
}

export function classifyTicketSla(
  ticket: Ticket,
  nowMs: number = Date.now(),
): SsInboxSlaStatus {
  if (!ticket.sla_due_at) return 'none';
  const due = Date.parse(ticket.sla_due_at);
  if (Number.isNaN(due)) return 'none';
  if (due < nowMs) return 'breached';
  if (due - nowMs <= 24 * 60 * 60 * 1000) return 'due_soon';
  return 'ok';
}

function moduleForService(
  service: SsService,
  stubs: SsInboxModuleStub[],
  hubModules: SsHubModule[],
): { href: string | null; todo: string | null } {
  const stub = stubs.find((s) => s.service === service);
  if (stub) return { href: stub.href, todo: stub.todo };
  const hub = hubModules.find((m) => m.service === service);
  return { href: hub?.href ?? null, todo: null };
}

export function buildRelatedLinks(ticket: Ticket): SsInboxRelatedLink[] {
  const links: SsInboxRelatedLink[] = [
    {
      label: ticket.ticket_id,
      href: `/shared-services/tickets/${ticket.ticket_id}`,
      kind: 'ticket',
    },
  ];
  if (ticket.entity_id) {
    links.push({
      label: ticket.entity_id,
      href: `/entities/${ticket.entity_id}`,
      kind: 'entity',
    });
  }
  if (ticket.source_doc_id) {
    links.push({
      label: 'Source doc',
      href: `/documents/${ticket.source_doc_id}`,
      kind: 'document',
    });
  }
  if (ticket.links) {
    const raw = ticket.links.trim();
    if (/^https?:\/\//i.test(raw)) {
      links.push({ label: 'Context', href: raw, kind: 'external' });
    }
  }
  return links;
}

/** Unify scoped tickets into inbox rows with SLA, ownership, escalations, links. */
export function buildUnifiedInboxRows(
  tickets: Ticket[],
  report: SharedServicesInboxPhase54Report,
  filters?: {
    service?: SsService | 'All' | null;
    entityId?: string | null;
    sla?: SsInboxSlaStatus | 'All' | null;
  },
): SsInboxRow[] {
  const escalatedIds = new Set(
    report.recent_escalations.map((e) => e.ticket_id),
  );
  const hubModules = getSsHubCardModules();
  const now = Date.now();
  const serviceFilter = filters?.service && filters.service !== 'All'
    ? filters.service
    : null;
  const entityFilter = filters?.entityId?.trim() || null;
  const slaFilter = filters?.sla && filters.sla !== 'All' ? filters.sla : null;

  const open = tickets.filter(
    (t) => t.status !== 'Resolved' && t.status !== 'Closed',
  );

  const rows: SsInboxRow[] = [];
  for (const ticket of open) {
    if (serviceFilter && ticket.service !== serviceFilter) continue;
    if (
      entityFilter &&
      !entityIdsEquivalent(ticket.entity_id, entityFilter)
    ) {
      continue;
    }

    let sla = classifyTicketSla(ticket, now);
    const escalated =
      escalatedIds.has(ticket.ticket_id) ||
      ticket.autonomy_band === 'ESCALATE' ||
      ticket.priority === 'P0';
    if (escalated && (sla === 'breached' || sla === 'none' || sla === 'ok')) {
      // Surface escalated visibility without hiding breach.
      if (sla !== 'breached') sla = 'escalated';
    }
    if (slaFilter) {
      if (slaFilter === 'escalated' && !escalated && sla !== 'escalated') {
        continue;
      }
      if (slaFilter !== 'escalated' && sla !== slaFilter) continue;
    }

    const mod = moduleForService(
      ticket.service,
      report.module_stubs,
      hubModules,
    );
    const related = buildRelatedLinks(ticket);
    if (mod.href) {
      related.push({
        label: `${ticket.service} module`,
        href: mod.href,
        kind: 'module',
      });
    }

    rows.push({
      ticket,
      sla_status: sla,
      escalated,
      owner: ticket.assignee_name?.trim() || 'Unassigned',
      related,
      module_href: mod.href,
      module_todo: mod.todo,
    });
  }

  const rank: Record<SsInboxSlaStatus, number> = {
    breached: 0,
    escalated: 1,
    due_soon: 2,
    none: 3,
    ok: 4,
  };
  rows.sort((a, b) => {
    const slaDiff = rank[a.sla_status] - rank[b.sla_status];
    if (slaDiff !== 0) return slaDiff;
    const pri = String(a.ticket.priority).localeCompare(String(b.ticket.priority));
    if (pri !== 0) return pri;
    return a.ticket.title.localeCompare(b.ticket.title);
  });

  return rows;
}

export function slaStatusLabel(status: SsInboxSlaStatus): string {
  if (status === 'due_soon') return 'Due soon';
  if (status === 'breached') return 'Breached';
  if (status === 'escalated') return 'Escalated';
  if (status === 'none') return 'No SLA';
  return 'On track';
}
