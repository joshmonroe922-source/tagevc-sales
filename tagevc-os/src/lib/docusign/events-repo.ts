/**
 * Persist DocuSign Connect / send events to os_docusign_events (Phase 21).
 * Schema: phase20_docusign_events.sql + phase21 extensions (deal_id, ticket_id, event_type).
 */

import { randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';

export type DocuSignEventInsert = {
  envelope_id: string;
  status: string;
  event_type?: string | null;
  /** Unique Connect/event id — generated if omitted */
  event_id?: string;
  doc_id?: string | null;
  entity_id?: string | null;
  deal_id?: string | null;
  ticket_id?: string | null;
  raw_payload?: Record<string, unknown> | null;
};

export type DocuSignEventRow = {
  id: string;
  event_id: string;
  envelope_id: string;
  status: string;
  event_type: string | null;
  doc_id: string | null;
  entity_id: string | null;
  deal_id: string | null;
  ticket_id: string | null;
  raw_payload: Record<string, unknown> | null;
  received_at: string;
};

export async function insertDocuSignEvent(
  row: DocuSignEventInsert,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const eventId = row.event_id?.trim() || `evt-${randomUUID()}`;
    const { data, error } = await sb
      .from('os_docusign_events')
      .insert({
        event_id: eventId,
        envelope_id: row.envelope_id,
        status: row.status,
        event_type: row.event_type ?? row.status,
        doc_id: row.doc_id ?? null,
        entity_id: row.entity_id ?? null,
        deal_id: row.deal_id ?? null,
        ticket_id: row.ticket_id ?? null,
        raw_payload: row.raw_payload ?? null,
      })
      .select('id')
      .single();

    if (error) {
      // Retry without Phase 21 columns if table is Phase 20-only
      if (
        error.message.includes('deal_id') ||
        error.message.includes('ticket_id') ||
        error.message.includes('event_type')
      ) {
        const retry = await sb
          .from('os_docusign_events')
          .insert({
            event_id: eventId,
            envelope_id: row.envelope_id,
            status: row.status,
            doc_id: row.doc_id ?? null,
            entity_id: row.entity_id ?? null,
            raw_payload: row.raw_payload ?? null,
          })
          .select('id')
          .single();
        if (retry.error) {
          console.error('[docusign] insert event failed', retry.error.message);
          return { ok: false, error: retry.error.message };
        }
        return { ok: true, id: (retry.data as { id: string }).id };
      }
      console.error('[docusign] insert event failed', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, id: (data as { id: string }).id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'insert failed';
    console.error('[docusign] insert event exception', msg);
    return { ok: false, error: msg };
  }
}

export async function listDocuSignEvents(opts?: {
  limit?: number;
  envelopeId?: string;
}): Promise<DocuSignEventRow[]> {
  try {
    const sb = await createPersistClient();
    let q = sb
      .from('os_docusign_events')
      .select(
        'id, event_id, envelope_id, status, event_type, doc_id, entity_id, deal_id, ticket_id, raw_payload, received_at',
      )
      .order('received_at', { ascending: false })
      .limit(opts?.limit ?? 50);

    if (opts?.envelopeId) {
      q = q.eq('envelope_id', opts.envelopeId);
    }

    const { data, error } = await q;
    if (error) {
      // Phase 20-only select fallback
      const fallback = await sb
        .from('os_docusign_events')
        .select(
          'id, event_id, envelope_id, status, doc_id, entity_id, raw_payload, received_at',
        )
        .order('received_at', { ascending: false })
        .limit(opts?.limit ?? 50);
      if (fallback.error) {
        console.error('[docusign] list events failed', fallback.error.message);
        return [];
      }
      return ((fallback.data ?? []) as Array<Record<string, unknown>>).map(
        (r) => ({
          id: String(r.id),
          event_id: String(r.event_id),
          envelope_id: String(r.envelope_id),
          status: String(r.status),
          event_type: null,
          doc_id: (r.doc_id as string) ?? null,
          entity_id: (r.entity_id as string) ?? null,
          deal_id: null,
          ticket_id: null,
          raw_payload: (r.raw_payload as Record<string, unknown>) ?? null,
          received_at: String(r.received_at),
        }),
      );
    }
    return (data ?? []) as DocuSignEventRow[];
  } catch (e) {
    console.error(
      '[docusign] list events exception',
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}

export async function countDocuSignEvents(): Promise<number | null> {
  try {
    const sb = await createPersistClient();
    const { count, error } = await sb
      .from('os_docusign_events')
      .select('*', { count: 'exact', head: true });
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}
