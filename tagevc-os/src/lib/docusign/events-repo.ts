/**
 * Persist DocuSign Connect / send events to os_docusign_events (Phase 21).
 * Schema: phase20_docusign_events.sql + phase21 extensions (deal_id, ticket_id, event_type).
 */

import { createHash } from 'crypto';
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
  occurred_at?: string | null;
  source?: string;
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
): Promise<
  | { ok: true; id: string; replayed: boolean }
  | { ok: false; error: string }
> {
  try {
    const sb = await createPersistClient();
    const payloadJson = JSON.stringify(row.raw_payload ?? {});
    const payloadSha256 = createHash('sha256')
      .update(payloadJson)
      .digest('hex');
    const dedupeKey = row.event_id?.trim()
      ? `provider:${row.event_id.trim()}`
      : createHash('sha256')
          .update(
            [
              row.envelope_id,
              row.event_type ?? row.status,
              row.status,
              row.occurred_at ?? '',
              payloadSha256,
            ].join('|'),
          )
          .digest('hex');
    const eventId =
      row.event_id?.trim() || `evt-${dedupeKey.slice(0, 32)}`;
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
        dedupe_key: dedupeKey,
        payload_sha256: payloadSha256,
        occurred_at: row.occurred_at ?? null,
        source: row.source ?? 'application',
        processing_status: 'recorded',
        processed_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') {
        const { data: existing } = await sb
          .from('os_docusign_events')
          .select('id')
          .eq('dedupe_key', dedupeKey)
          .maybeSingle();
        if (existing?.id) {
          return { ok: true, id: String(existing.id), replayed: true };
        }
      }
      // Retry without Phase 21 columns if table is Phase 20-only
      if (
        error.message.includes('deal_id') ||
        error.message.includes('ticket_id') ||
        error.message.includes('event_type') ||
        error.message.includes('dedupe_key') ||
        error.message.includes('payload_sha256') ||
        error.message.includes('occurred_at') ||
        error.message.includes('processing_status')
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
        return {
          ok: true,
          id: (retry.data as { id: string }).id,
          replayed: false,
        };
      }
      console.error('[docusign] insert event failed', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, id: (data as { id: string }).id, replayed: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'insert failed';
    console.error('[docusign] insert event exception', msg);
    return { ok: false, error: msg };
  }
}

export async function listDocuSignEvents(opts?: {
  limit?: number;
  envelopeId?: string;
  status?: string;
  eventType?: string;
  search?: string;
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
    if (opts?.status?.trim()) {
      q = q.eq('status', opts.status.trim().toLowerCase());
    }
    if (opts?.eventType?.trim()) {
      q = q.eq('event_type', opts.eventType.trim());
    }
    if (opts?.search?.trim()) {
      const term = opts.search
        .trim()
        .replace(/[,%()]/g, '')
        .slice(0, 100);
      if (term) {
        q = q.or(
          [
            `envelope_id.ilike.%${term}%`,
            `doc_id.ilike.%${term}%`,
            `entity_id.ilike.%${term}%`,
            `deal_id.ilike.%${term}%`,
            `ticket_id.ilike.%${term}%`,
          ].join(','),
        );
      }
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
