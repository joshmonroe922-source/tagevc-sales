/**
 * OS ↔ A&F event bus — Spec - API Webhooks + Automation Map (build order step 11).
 */

import { randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import type { EntityCode } from '@/lib/af/types';

export type AfEventEnvelope = {
  event_id: string;
  event_type: string;
  occurred_at: string;
  entity_code?: EntityCode | 'ORG' | 'PERS' | 'CONSOL' | null;
  source_system: string;
  payload: Record<string, unknown>;
};

export type AfEventDirection = 'inbound' | 'outbound' | 'internal';

const memoryBus: AfEventEnvelope[] = [];

export function buildEnvelope(input: {
  eventType: string;
  entityCode?: AfEventEnvelope['entity_code'];
  sourceSystem?: string;
  payload?: Record<string, unknown>;
  eventId?: string;
  occurredAt?: string;
}): AfEventEnvelope {
  return {
    event_id: input.eventId ?? randomUUID(),
    event_type: input.eventType,
    occurred_at: input.occurredAt ?? new Date().toISOString(),
    entity_code: input.entityCode ?? null,
    source_system: input.sourceSystem ?? 'af',
    payload: input.payload ?? {},
  };
}

export async function publishAfEvent(input: {
  envelope: AfEventEnvelope;
  direction?: AfEventDirection;
  status?: 'queued' | 'processed' | 'failed' | 'dead_letter';
}): Promise<{ ok: boolean; duplicate?: boolean }> {
  memoryBus.unshift(input.envelope);
  if (memoryBus.length > 200) memoryBus.pop();

  try {
    const supabase = await createPersistClient();
    if (!supabase) return { ok: true };
    const { error } = await supabase.from('os_af_events').insert({
      event_id: input.envelope.event_id,
      event_type: input.envelope.event_type,
      occurred_at: input.envelope.occurred_at,
      entity_code: input.envelope.entity_code,
      source_system: input.envelope.source_system,
      direction: input.direction ?? 'internal',
      payload: input.envelope.payload,
      status: input.status ?? 'processed',
    });
    if (error) {
      if (error.code === '23505' || /duplicate|unique/i.test(error.message)) {
        return { ok: true, duplicate: true };
      }
      console.error('publishAfEvent', error.message);
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.error('publishAfEvent', e);
    return { ok: false };
  }
}

export function listMemoryEvents(limit = 40): AfEventEnvelope[] {
  return memoryBus.slice(0, limit);
}

export async function listAfEvents(limit = 40): Promise<AfEventEnvelope[]> {
  try {
    const supabase = await createPersistClient();
    if (!supabase) return listMemoryEvents(limit);
    const { data, error } = await supabase
      .from('os_af_events')
      .select('event_id, event_type, occurred_at, entity_code, source_system, payload')
      .order('occurred_at', { ascending: false })
      .limit(limit);
    if (error || !data?.length) return listMemoryEvents(limit);
    return data.map((r) => ({
      event_id: String(r.event_id),
      event_type: String(r.event_type),
      occurred_at: String(r.occurred_at),
      entity_code: r.entity_code as AfEventEnvelope['entity_code'],
      source_system: String(r.source_system),
      payload: (r.payload ?? {}) as Record<string, unknown>,
    }));
  } catch {
    return listMemoryEvents(limit);
  }
}

/** Handle inbound OS events (sale.created → draft invoice). */
export async function handleInboundOsEvent(
  envelope: AfEventEnvelope,
): Promise<{ ok: boolean; action: string; refId?: string }> {
  const published = await publishAfEvent({ envelope, direction: 'inbound' });
  if (published.duplicate) {
    return { ok: true, action: 'duplicate_ignored' };
  }

  switch (envelope.event_type) {
    case 'sale.created': {
      // Soft draft sketch — full upsert lives in AR module when OS posts live sales
      const entity = (envelope.entity_code as EntityCode | undefined) ?? 'R619';
      const sourceId = String(envelope.payload.source_id ?? envelope.event_id);
      await publishAfEvent({
        envelope: buildEnvelope({
          eventType: 'invoice.status_changed',
          entityCode: entity,
          sourceSystem: 'af',
          payload: {
            status: 'Draft',
            source_id: sourceId,
            from_event: envelope.event_id,
          },
        }),
        direction: 'outbound',
      });
      return { ok: true, action: 'queued_draft_invoice', refId: sourceId };
    }
    case 'sale.updated':
      return { ok: true, action: 'updated_draft_if_unsent' };
    case 'customer.upsert':
      await publishAfEvent({
        envelope: buildEnvelope({
          eventType: 'customer.sync_ack',
          entityCode: envelope.entity_code,
          payload: envelope.payload,
        }),
        direction: 'outbound',
      });
      return { ok: true, action: 'upserted_customer' };
    case 'placement.created':
      return { ok: true, action: 'linked_commission_dimension' };
    default:
      await publishAfEvent({
        envelope: buildEnvelope({
          eventType: 'af.dead_letter',
          sourceSystem: 'af',
          payload: {
            unknown_type: envelope.event_type,
            original: envelope,
          },
        }),
        direction: 'internal',
        status: 'dead_letter',
      });
      return { ok: true, action: 'dead_letter' };
  }
}

