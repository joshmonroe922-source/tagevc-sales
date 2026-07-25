import { createPersistClient } from '@/lib/supabase/persist-client';
import type { Ticket } from '@/lib/types';

function ticketToRow(ticket: Ticket) {
  return {
    id: ticket.id,
    ticket_id: ticket.ticket_id,
    title: ticket.title,
    description: ticket.description,
    desired_outcome: ticket.desired_outcome,
    service: ticket.service,
    priority: ticket.priority,
    status: ticket.status,
    requester_name: ticket.requester_name,
    assignee_name: ticket.assignee_name,
    entity_id: ticket.entity_id,
    company_name: ticket.company_name,
    links: ticket.links,
    sla_due_at: ticket.sla_due_at,
    autonomy_band: ticket.autonomy_band,
    confidence: ticket.confidence,
    diagnose_reasoning: ticket.diagnose_reasoning,
    diagnose_summary: ticket.diagnose_summary ?? '',
    proposed_action: ticket.proposed_action,
    proposed_actions: ticket.proposed_actions ?? [],
    forbid_hits: ticket.forbid_hits,
    on_allow_list: ticket.on_allow_list,
    draft_approval: ticket.draft_approval,
    recommendation: ticket.recommendation,
    policy_version: ticket.policy_version,
    ai_generated: ticket.ai_generated,
    source_doc_id: ticket.source_doc_id,
    ai_suggestion_id: ticket.ai_suggestion_id,
    source_system: ticket.source_system ?? 'tage',
    source_ref: ticket.source_ref ?? null,
    auto_attempted_at: ticket.auto_attempted_at ?? null,
    auto_result: ticket.auto_result ?? null,
    escalation_reason: ticket.escalation_reason ?? '',
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
    resolved_at: ticket.resolved_at,
  };
}

function rowToTicket(row: Record<string, unknown>): Ticket {
  const hits = row.forbid_hits;
  const actions = row.proposed_actions;
  return {
    id: String(row.id),
    ticket_id: String(row.ticket_id),
    title: String(row.title),
    description: (row.description as string | null) ?? null,
    desired_outcome: (row.desired_outcome as string | null) ?? null,
    service: row.service as Ticket['service'],
    priority: row.priority as Ticket['priority'],
    status: row.status as Ticket['status'],
    requester_name: (row.requester_name as string | null) ?? null,
    assignee_name: (row.assignee_name as string | null) ?? null,
    entity_id: (row.entity_id as string | null) ?? null,
    company_name: (row.company_name as string | null) ?? null,
    links: (row.links as string | null) ?? null,
    sla_due_at: (row.sla_due_at as string | null) ?? null,
    autonomy_band: row.autonomy_band as Ticket['autonomy_band'],
    confidence: Number(row.confidence ?? 0),
    diagnose_reasoning: String(row.diagnose_reasoning ?? ''),
    diagnose_summary: String(row.diagnose_summary ?? ''),
    proposed_action: (row.proposed_action as string | null) ?? null,
    proposed_actions: Array.isArray(actions)
      ? (actions as Ticket['proposed_actions'])
      : [],
    forbid_hits: Array.isArray(hits) ? (hits as Ticket['forbid_hits']) : [],
    on_allow_list: Boolean(row.on_allow_list),
    draft_approval: (row.draft_approval as Ticket['draft_approval']) ?? 'n/a',
    recommendation: (row.recommendation as string | null) ?? null,
    policy_version: (row.policy_version as Ticket['policy_version']) ?? 'v1',
    ai_generated: Boolean(row.ai_generated),
    source_doc_id: (row.source_doc_id as string | null) ?? null,
    ai_suggestion_id: (row.ai_suggestion_id as string | null) ?? null,
    source_system:
      (row.source_system as Ticket['source_system']) ?? 'tage',
    source_ref: (row.source_ref as string | null) ?? null,
    auto_attempted_at: (row.auto_attempted_at as string | null) ?? null,
    auto_result: (row.auto_result as Ticket['auto_result']) ?? null,
    escalation_reason: String(row.escalation_reason ?? ''),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    resolved_at: (row.resolved_at as string | null) ?? null,
  };
}

export async function fetchAllTickets(): Promise<Ticket[] | null> {
  try {
    const supabase = await createPersistClient();
    const { data, error } = await supabase
      .from('os_tickets')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) {
      console.error('fetchAllTickets', error.message);
      return null;
    }
    return (data ?? []).map((r) => rowToTicket(r as Record<string, unknown>));
  } catch (e) {
    console.error('fetchAllTickets', e);
    return null;
  }
}

export async function syncTickets(tickets: Ticket[]): Promise<boolean> {
  try {
    if (tickets.length === 0) return true;
    const supabase = await createPersistClient();
    const { error } = await supabase
      .from('os_tickets')
      .upsert(tickets.map(ticketToRow), { onConflict: 'ticket_id' });
    if (error) {
      console.error('syncTickets', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('syncTickets', e);
    return false;
  }
}
