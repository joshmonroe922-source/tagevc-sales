import { createPersistClient } from '@/lib/supabase/persist-client';
import type { AgentAuditLog, DocAuditEvent, IcAuditEvent } from '@/lib/types';

function icToRow(e: IcAuditEvent) {
  return {
    id: e.id,
    event_id: e.event_id,
    ic_id: e.ic_id,
    deal_id: e.deal_id,
    action: e.action,
    decision: e.decision,
    detail: e.detail,
    actor: e.actor,
    created_at: e.created_at,
  };
}

function rowToIc(row: Record<string, unknown>): IcAuditEvent {
  return {
    id: String(row.id),
    event_id: String(row.event_id),
    ic_id: String(row.ic_id),
    deal_id: String(row.deal_id),
    action: String(row.action),
    decision: (row.decision as IcAuditEvent['decision']) ?? null,
    detail: String(row.detail ?? ''),
    actor: String(row.actor),
    created_at: String(row.created_at),
  };
}

function ticketAuditToRow(a: AgentAuditLog) {
  return {
    id: a.id,
    audit_id: a.audit_id,
    ticket_id: a.ticket_id,
    band: a.band,
    confidence: a.confidence,
    action: a.action,
    reasoning: a.reasoning,
    forbid_hits: a.forbid_hits,
    approval: a.approval,
    payload_hash: a.payload_hash,
    actor: a.actor,
    created_at: a.created_at,
  };
}

function rowToTicketAudit(row: Record<string, unknown>): AgentAuditLog {
  const hits = row.forbid_hits;
  return {
    id: String(row.id),
    audit_id: String(row.audit_id),
    ticket_id: String(row.ticket_id),
    band: row.band as AgentAuditLog['band'],
    confidence: Number(row.confidence ?? 0),
    action: String(row.action),
    reasoning: String(row.reasoning ?? ''),
    forbid_hits: Array.isArray(hits)
      ? (hits as AgentAuditLog['forbid_hits'])
      : [],
    approval: (row.approval as string | null) ?? null,
    payload_hash: (row.payload_hash as string | null) ?? null,
    actor: row.actor as AgentAuditLog['actor'],
    created_at: String(row.created_at),
  };
}

function docAuditToRow(e: DocAuditEvent) {
  return {
    id: e.id,
    event_id: e.event_id,
    doc_id: e.doc_id,
    action: e.action,
    actor: e.actor,
    detail: e.detail,
    created_at: e.created_at,
  };
}

function rowToDocAudit(row: Record<string, unknown>): DocAuditEvent {
  return {
    id: String(row.id),
    event_id: String(row.event_id),
    doc_id: String(row.doc_id),
    action: String(row.action),
    actor: row.actor as DocAuditEvent['actor'],
    detail: String(row.detail ?? ''),
    created_at: String(row.created_at),
  };
}

export async function fetchAllIcAudits(): Promise<IcAuditEvent[] | null> {
  try {
    const supabase = await createPersistClient();
    const { data, error } = await supabase
      .from('os_ic_audits')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('fetchAllIcAudits', error.message);
      return null;
    }
    return (data ?? []).map((r) => rowToIc(r as Record<string, unknown>));
  } catch (e) {
    console.error('fetchAllIcAudits', e);
    return null;
  }
}

export async function syncIcAudits(events: IcAuditEvent[]): Promise<boolean> {
  try {
    if (events.length === 0) return true;
    const supabase = await createPersistClient();
    const { error } = await supabase
      .from('os_ic_audits')
      .upsert(events.map(icToRow), { onConflict: 'event_id' });
    if (error) {
      console.error('syncIcAudits', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('syncIcAudits', e);
    return false;
  }
}

export async function fetchAllTicketAudits(): Promise<AgentAuditLog[] | null> {
  try {
    const supabase = await createPersistClient();
    const { data, error } = await supabase
      .from('os_ticket_audits')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('fetchAllTicketAudits', error.message);
      return null;
    }
    return (data ?? []).map((r) =>
      rowToTicketAudit(r as Record<string, unknown>),
    );
  } catch (e) {
    console.error('fetchAllTicketAudits', e);
    return null;
  }
}

export async function syncTicketAudits(
  audits: AgentAuditLog[],
): Promise<boolean> {
  try {
    if (audits.length === 0) return true;
    const supabase = await createPersistClient();
    const { error } = await supabase
      .from('os_ticket_audits')
      .upsert(audits.map(ticketAuditToRow), { onConflict: 'audit_id' });
    if (error) {
      console.error('syncTicketAudits', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('syncTicketAudits', e);
    return false;
  }
}

export async function fetchAllDocAudits(): Promise<DocAuditEvent[] | null> {
  try {
    const supabase = await createPersistClient();
    const { data, error } = await supabase
      .from('os_doc_audits')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('fetchAllDocAudits', error.message);
      return null;
    }
    return (data ?? []).map((r) => rowToDocAudit(r as Record<string, unknown>));
  } catch (e) {
    console.error('fetchAllDocAudits', e);
    return null;
  }
}

export async function syncDocAudits(events: DocAuditEvent[]): Promise<boolean> {
  try {
    if (events.length === 0) return true;
    const supabase = await createPersistClient();
    const { error } = await supabase
      .from('os_doc_audits')
      .upsert(events.map(docAuditToRow), { onConflict: 'event_id' });
    if (error) {
      console.error('syncDocAudits', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('syncDocAudits', e);
    return false;
  }
}
