/**
 * Portfolio Handoff seam (Excel Portfolio Handoff sheet).
 * At wire / acquire / purchase: create PH pack → Ready for Portfolio Active.
 * Full Entity Master + Portfolio Active row creation remains Phase 1 seed /
 * future persistence — this module makes the handoff boundary explicit.
 */
import { randomUUID } from 'crypto';
import type {
  DealPath,
  DealTrack,
  HandoffPack,
  HandoffStatus,
} from '@/lib/types';

export type CreateHandoffInput = {
  track: DealTrack;
  source_id: string;
  company_name: string;
  path?: DealPath | null;
  close_date?: string | null;
  thesis?: string | null;
  existing: HandoffPack[];
};

function nextHandoffId(existing: HandoffPack[]): string {
  const max = existing.reduce((m, h) => {
    const n = Number(h.handoff_id.replace(/\D/g, ''));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `PH-${String(max + 1).padStart(3, '0')}`;
}

export function createHandoffPack(input: CreateHandoffInput): HandoffPack {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    handoff_id: nextHandoffId(input.existing),
    track: input.track,
    source_id: input.source_id,
    company_name: input.company_name,
    entity_id: null,
    portfolio_id: null,
    status: 'Ready for Portfolio',
    path: input.path ?? null,
    close_date: input.close_date ?? now.slice(0, 10),
    thesis: input.thesis ?? null,
    checklist_notes:
      'Stub: link Entity Master (ENT-*) + add Portfolio Active row in persistence layer.',
    created_at: now,
    updated_at: now,
  };
}

export function markHandoffLinked(
  pack: HandoffPack,
  entityId: string,
  portfolioId: string,
): HandoffPack {
  return {
    ...pack,
    entity_id: entityId,
    portfolio_id: portfolioId,
    status: 'Linked' satisfies HandoffStatus,
    updated_at: new Date().toISOString(),
  };
}
