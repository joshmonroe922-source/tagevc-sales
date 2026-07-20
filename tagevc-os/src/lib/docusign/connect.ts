/**
 * Parse DocuSign Connect JSON (and simple mock payloads) into a status update.
 */

import type { DocusignEnvelopeStatus } from './types';

const STATUS_SET = new Set<string>([
  'created',
  'sent',
  'delivered',
  'signed',
  'completed',
  'declined',
  'voided',
]);

export type ParsedConnectEvent = {
  envelope_id: string;
  status: DocusignEnvelopeStatus;
  event_id: string | null;
  event_type: string;
  raw: Record<string, unknown>;
};

function normalizeStatus(raw: string): DocusignEnvelopeStatus | null {
  const s = raw.trim().toLowerCase();
  // DocuSign sometimes uses "recipient-completed" style — map common aliases
  if (s === 'recipient-completed' || s === 'finish') return 'completed';
  if (STATUS_SET.has(s)) return s as DocusignEnvelopeStatus;
  return null;
}

/**
 * Accepts:
 * 1) Simple mock: { envelope_id, status }
 * 2) Connect JSON: { event, data: { envelopeId, envelopeSummary: { status } } }
 */
export function parseConnectPayload(
  body: unknown,
): ParsedConnectEvent | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Body must be a JSON object' };
  }
  const raw = body as Record<string, unknown>;

  // Simple / mock shape
  if (typeof raw.envelope_id === 'string' && typeof raw.status === 'string') {
    const status = normalizeStatus(raw.status);
    if (!status) return { error: `Unknown status: ${raw.status}` };
    return {
      envelope_id: raw.envelope_id,
      status,
      event_id:
        typeof raw.event_id === 'string' ? raw.event_id : null,
      event_type: typeof raw.event === 'string' ? raw.event : status,
      raw,
    };
  }

  // DocuSign Connect REST JSON
  const data = raw.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    const envelopeId =
      (typeof d.envelopeId === 'string' && d.envelopeId) ||
      (typeof d.envelope_id === 'string' && d.envelope_id) ||
      null;

    let statusRaw: string | null = null;
    const summary = d.envelopeSummary;
    if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
      const st = (summary as Record<string, unknown>).status;
      if (typeof st === 'string') statusRaw = st;
    }
    if (!statusRaw && typeof d.status === 'string') statusRaw = d.status;
    if (!statusRaw && typeof raw.event === 'string') {
      // envelope-sent → sent
      const m = /^envelope-(.+)$/i.exec(raw.event);
      if (m) statusRaw = m[1];
    }

    if (!envelopeId) return { error: 'Connect payload missing envelopeId' };
    if (!statusRaw) return { error: 'Connect payload missing status' };
    const status = normalizeStatus(statusRaw);
    if (!status) return { error: `Unknown Connect status: ${statusRaw}` };

    const eventId =
      (typeof raw.generateId === 'string' && raw.generateId) ||
      (typeof raw.eventId === 'string' && raw.eventId) ||
      null;

    return {
      envelope_id: envelopeId,
      status,
      event_id: eventId,
      event_type: typeof raw.event === 'string' ? raw.event : status,
      raw,
    };
  }

  return {
    error:
      'Unrecognized payload — expected { envelope_id, status } or Connect data.envelopeId',
  };
}
