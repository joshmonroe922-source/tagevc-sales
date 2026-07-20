import { createHash, randomUUID } from 'crypto';
import { logActivity } from '@/lib/data/activity';
import {
  isStoreHydrated,
  loadStoreSnapshot,
  markStoreHydrated,
  queueStorePersist,
  saveStoreSnapshot,
} from '@/lib/data/persist';
import {
  assertCanAutoExecute,
  diagnoseTicket,
} from '@/lib/shared-services/diagnose';
import type {
  AgentAuditLog,
  AutonomyBand,
  SsService,
  Ticket,
  TicketPriority,
  TicketStatus,
} from '@/lib/types';

type TicketStore = {
  tickets: Ticket[];
  audits: AgentAuditLog[];
};

declare global {
  var __tageTicketStore: TicketStore | undefined;
}

const now = '2026-03-15T12:00:00.000Z';

function seedTickets(): Ticket[] {
  const samples: Array<{
    ticket_id: string;
    title: string;
    description: string;
    desired_outcome: string;
    service: SsService;
    priority: TicketPriority;
  }> = [
    {
      ticket_id: 'TK-001',
      title: 'SLA nudge for overdue IT access request',
      description: 'Please send an SLA nudge to the assignee on the open joiner ticket.',
      desired_outcome: 'Assignee reminded within SLA',
      service: 'IT',
      priority: 'P2',
    },
    {
      ticket_id: 'TK-002',
      title: 'Draft IC memo narrative for Orbit Data',
      description: 'Need a draft IC memo summary from DD notes — medium complexity.',
      desired_outcome: 'Partner-ready draft for review',
      service: 'Legal',
      priority: 'P1',
    },
    {
      ticket_id: 'TK-003',
      title: 'Wire funds for closing Orbit Data check',
      description: 'Please wire funds per dual-control pay instructions for the deal close.',
      desired_outcome: 'Capital wired and confirmed',
      service: 'Finance',
      priority: 'P0',
    },
    {
      ticket_id: 'TK-004',
      title: 'Change portfolio Health to At Risk for Sample Closed Co',
      description: 'Set health status on Portfolio Active to At Risk after GTM slip.',
      desired_outcome: 'Health updated on Portfolio Active',
      service: 'Finance',
      priority: 'P1',
    },
    {
      ticket_id: 'TK-005',
      title: 'Route inbound form to VC pipeline',
      description: 'Marketing form routing — route inbound to correct VC track.',
      desired_outcome: 'Lead appears on Pipeline Active',
      service: 'Marketing',
      priority: 'P3',
    },
  ];

  const entityByTicket: Record<
    string,
    { entity_id: string | null; company_name: string | null }
  > = {
    'TK-001': { entity_id: 'ENT-002', company_name: 'Instant NDA' },
    'TK-002': { entity_id: null, company_name: 'Orbit Data' },
    'TK-003': { entity_id: null, company_name: 'Orbit Data' },
    'TK-004': { entity_id: 'ENT-001', company_name: 'Sample Closed Co' },
    'TK-005': { entity_id: null, company_name: null },
  };

  return samples.map((s, i) => {
    const d = diagnoseTicket(s);
    const link = entityByTicket[s.ticket_id] ?? {
      entity_id: null,
      company_name: null,
    };
    return {
      id: `66666666-6666-4666-8666-66666666660${i + 1}`,
      ticket_id: s.ticket_id,
      title: s.title,
      description: s.description,
      desired_outcome: s.desired_outcome,
      service: s.service,
      priority: s.priority,
      status: 'Open' as TicketStatus,
      requester_name: 'Associate',
      assignee_name: null,
      entity_id: link.entity_id,
      company_name: link.company_name,
      links: null,
      sla_due_at: '2026-03-20',
      autonomy_band: d.band,
      confidence: d.confidence,
      diagnose_reasoning: d.reasoning,
      proposed_action: d.proposed_action,
      forbid_hits: d.forbid_hits,
      on_allow_list: d.on_allow_list,
      draft_approval: d.band === 'DRAFT' ? 'pending' : 'n/a',
      recommendation: d.recommendation,
      policy_version: d.policy_version,
      ai_generated: false,
      source_doc_id: null,
      ai_suggestion_id: null,
      created_at: now,
      updated_at: now,
      resolved_at: null,
    };
  });
}

function createStore(): TicketStore {
  const tickets = seedTickets();
  const audits: AgentAuditLog[] = tickets.map((t, i) => ({
    id: `77777777-7777-4777-8777-77777777770${i + 1}`,
    audit_id: `AU-${String(i + 1).padStart(3, '0')}`,
    ticket_id: t.ticket_id,
    band: t.autonomy_band,
    confidence: t.confidence,
    action: 'diagnose',
    reasoning: t.diagnose_reasoning,
    forbid_hits: t.forbid_hits,
    approval: null,
    payload_hash: null,
    actor: 'agent',
    created_at: now,
  }));
  return { tickets, audits };
}

export function getTicketStore(): TicketStore {
  if (!globalThis.__tageTicketStore) {
    globalThis.__tageTicketStore = createStore();
  }
  return globalThis.__tageTicketStore;
}

function touchTickets() {
  queueStorePersist('tickets', () => structuredClone(getTicketStore()));
}

export async function hydrateTicketStore() {
  if (isStoreHydrated('tickets')) return;
  const snap = await loadStoreSnapshot<TicketStore>('tickets');
  if (snap?.payload?.tickets) {
    globalThis.__tageTicketStore = snap.payload;
  } else {
    const store = getTicketStore();
    await saveStoreSnapshot('tickets', store);
  }
  markStoreHydrated('tickets');
}

function nextTicketId(tickets: Ticket[]): string {
  const max = tickets.reduce((m, t) => {
    const n = Number(t.ticket_id.replace(/\D/g, ''));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `TK-${String(max + 1).padStart(3, '0')}`;
}

function nextAuditId(audits: AgentAuditLog[]): string {
  const max = audits.reduce((m, a) => {
    const n = Number(a.audit_id.replace(/\D/g, ''));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `AU-${String(max + 1).padStart(3, '0')}`;
}

function appendAudit(
  store: TicketStore,
  entry: Omit<AgentAuditLog, 'id' | 'audit_id' | 'created_at'>,
) {
  const row: AgentAuditLog = {
    id: randomUUID(),
    audit_id: nextAuditId(store.audits),
    created_at: new Date().toISOString(),
    ...entry,
  };
  store.audits.push(row);
  return row;
}

export type CreateTicketInput = {
  title: string;
  description?: string;
  desired_outcome?: string;
  service: SsService;
  priority: TicketPriority;
  requester_name?: string;
  entity_id?: string;
  company_name?: string;
  links?: string;
  sla_due_at?: string;
  /** Phase 4.5 — document AI follow-ups */
  ai_generated?: boolean;
  source_doc_id?: string | null;
  ai_suggestion_id?: string | null;
};

export type CreateAiDocumentTicketInput = {
  doc_id: string;
  entity_id: string | null;
  suggestion: {
    suggestion_id: string;
    title: string;
    description: string;
    due_date: string | null;
    service: SsService;
    priority: TicketPriority;
  };
};

/** Open ticket from a document AI suggestion (pending human accept/dismiss on doc). */
export function createAiDocumentTicket(
  input: CreateAiDocumentTicketInput,
): Ticket {
  const docLink = `/documents/${input.doc_id}`;
  return createTicket({
    title: `[AI] ${input.suggestion.title}`,
    description: [
      'AI-generated follow-up from document review (pending human confirmation on the document page).',
      '',
      input.suggestion.description,
      '',
      `Source: ${docLink}`,
    ].join('\n'),
    desired_outcome: 'Confirm or dismiss the AI suggestion on the source document',
    service: input.suggestion.service,
    priority: input.suggestion.priority,
    requester_name: 'Document AI',
    entity_id: input.entity_id ?? undefined,
    links: docLink,
    sla_due_at: input.suggestion.due_date ?? undefined,
    ai_generated: true,
    source_doc_id: input.doc_id,
    ai_suggestion_id: input.suggestion.suggestion_id,
  });
}

export function createTicket(input: CreateTicketInput): Ticket {
  const store = getTicketStore();
  const diagnosis = diagnoseTicket(input);
  const ts = new Date().toISOString();
  const ticket: Ticket = {
    id: randomUUID(),
    ticket_id: nextTicketId(store.tickets),
    title: input.title.trim(),
    description: input.description?.trim() || null,
    desired_outcome: input.desired_outcome?.trim() || null,
    service: input.service,
    priority: input.priority,
    status: 'Open',
    requester_name: input.requester_name?.trim() || 'Requester',
    assignee_name: null,
    entity_id: input.entity_id?.trim() || null,
    company_name: input.company_name?.trim() || null,
    links: input.links?.trim() || null,
    sla_due_at: input.sla_due_at || null,
    autonomy_band: diagnosis.band,
    confidence: diagnosis.confidence,
    diagnose_reasoning: diagnosis.reasoning,
    proposed_action: diagnosis.proposed_action,
    forbid_hits: diagnosis.forbid_hits,
    on_allow_list: diagnosis.on_allow_list,
    draft_approval: diagnosis.band === 'DRAFT' ? 'pending' : 'n/a',
    recommendation: diagnosis.recommendation,
    policy_version: diagnosis.policy_version,
    ai_generated: input.ai_generated ?? false,
    source_doc_id: input.source_doc_id ?? null,
    ai_suggestion_id: input.ai_suggestion_id ?? null,
    created_at: ts,
    updated_at: ts,
    resolved_at: null,
  };
  store.tickets.push(ticket);
  appendAudit(store, {
    ticket_id: ticket.ticket_id,
    band: ticket.autonomy_band,
    confidence: ticket.confidence,
    action: 'diagnose',
    reasoning: ticket.diagnose_reasoning,
    forbid_hits: ticket.forbid_hits,
    approval: null,
    payload_hash: null,
    actor: 'agent',
  });

  // v1: AUTO allow-list actions execute + log immediately (no side effects beyond log for now)
  if (ticket.autonomy_band === 'AUTO') {
    try {
      assertCanAutoExecute({
        band: ticket.autonomy_band,
        confidence: ticket.confidence,
        forbid_hits: ticket.forbid_hits,
        on_allow_list: ticket.on_allow_list,
        priority: ticket.priority,
      });
      const payload = JSON.stringify({
        action: ticket.proposed_action,
        ticket_id: ticket.ticket_id,
      });
      appendAudit(store, {
        ticket_id: ticket.ticket_id,
        band: 'AUTO',
        confidence: ticket.confidence,
        action: `auto_execute:${ticket.proposed_action}`,
        reasoning: `Executed allow-listed action under policy ${ticket.policy_version}`,
        forbid_hits: [],
        approval: 'n/a',
        payload_hash: createHash('sha256').update(payload).digest('hex').slice(0, 16),
        actor: 'agent',
      });
      ticket.status = 'In Progress';
      ticket.updated_at = new Date().toISOString();
    } catch (e) {
      // Safety: demote to ESCALATE if guard fails
      ticket.autonomy_band = 'ESCALATE';
      ticket.recommendation =
        e instanceof Error ? e.message : 'AUTO blocked by policy guard';
      appendAudit(store, {
        ticket_id: ticket.ticket_id,
        band: 'ESCALATE',
        confidence: ticket.confidence,
        action: 'auto_blocked',
        reasoning: ticket.recommendation,
        forbid_hits: ticket.forbid_hits,
        approval: null,
        payload_hash: null,
        actor: 'agent',
      });
    }
  }

  touchTickets();
  void logActivity({
    module: 'shared_services',
    action: 'ticket_created',
    title: `Ticket created: ${ticket.title}`,
    ref_type: 'ticket',
    ref_id: ticket.ticket_id,
    entity_id: ticket.entity_id ?? undefined,
  });
  return ticket;
}

export function listTickets(): Ticket[] {
  return [...getTicketStore().tickets].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
}

export function getTicket(ticketId: string): Ticket | null {
  return (
    getTicketStore().tickets.find((t) => t.ticket_id === ticketId) ?? null
  );
}

export function listAuditsForTicket(ticketId: string): AgentAuditLog[] {
  return getTicketStore()
    .audits.filter((a) => a.ticket_id === ticketId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function countByBand(): Record<AutonomyBand, number> {
  const counts: Record<AutonomyBand, number> = {
    AUTO: 0,
    DRAFT: 0,
    ESCALATE: 0,
  };
  for (const t of getTicketStore().tickets) {
    if (t.status === 'Closed' || t.status === 'Resolved') continue;
    counts[t.autonomy_band] += 1;
  }
  return counts;
}

export function setDraftApproval(
  ticketId: string,
  approval: 'approved' | 'rejected',
): Ticket {
  const store = getTicketStore();
  const ticket = store.tickets.find((t) => t.ticket_id === ticketId);
  if (!ticket) throw new Error('Ticket not found');
  if (ticket.autonomy_band !== 'DRAFT') {
    throw new Error('Only DRAFT tickets accept Approve/Reject');
  }
  ticket.draft_approval = approval;
  ticket.updated_at = new Date().toISOString();
  if (approval === 'approved') {
    ticket.status = 'In Progress';
  }
  appendAudit(store, {
    ticket_id: ticket.ticket_id,
    band: 'DRAFT',
    confidence: ticket.confidence,
    action: `draft_${approval}`,
    reasoning: `Human ${approval} draft before side effects`,
    forbid_hits: ticket.forbid_hits,
    approval,
    payload_hash: null,
    actor: 'human',
  });
  touchTickets();
  void logActivity({
    module: 'shared_services',
    action: `draft_${approval}`,
    title: `Draft ${approval}: ${ticket.title}`,
    ref_type: 'ticket',
    ref_id: ticket.ticket_id,
  });
  return ticket;
}

export function resolveTicket(ticketId: string): Ticket {
  const store = getTicketStore();
  const ticket = store.tickets.find((t) => t.ticket_id === ticketId);
  if (!ticket) throw new Error('Ticket not found');
  if (ticket.priority === 'P0' && ticket.forbid_hits.includes('silent_close_p0')) {
    throw new Error('P0/security cannot silent-close without human ack path');
  }
  // P0 always requires explicit human resolve — allowed here as human action
  const ts = new Date().toISOString();
  ticket.status = 'Resolved';
  ticket.resolved_at = ts;
  ticket.updated_at = ts;
  appendAudit(store, {
    ticket_id: ticket.ticket_id,
    band: ticket.autonomy_band,
    confidence: ticket.confidence,
    action: 'resolve',
    reasoning: 'Service Lead closed ticket',
    forbid_hits: ticket.forbid_hits,
    approval: 'human',
    payload_hash: null,
    actor: 'human',
  });
  touchTickets();
  void logActivity({
    module: 'shared_services',
    action: 'ticket_resolved',
    title: `Ticket resolved: ${ticket.title}`,
    ref_type: 'ticket',
    ref_id: ticket.ticket_id,
  });
  return ticket;
}
