import { describe, expect, it } from 'vitest';
import { filterOutstandingTicketsForFunction } from '@/lib/shared-services/ssc-function-tickets';
import type { Ticket } from '@/lib/types';

function ticket(partial: Partial<Ticket> & Pick<Ticket, 'ticket_id' | 'service'>): Ticket {
  return {
    title: 'Test',
    status: 'Open',
    priority: 'P2',
    entity_id: 'ENT-FIRM',
    company_name: 'Tage',
    autonomy_band: 'DRAFT',
    confidence: 70,
    draft_approval: 'pending',
    ai_generated: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  } as Ticket;
}

describe('SSC function outstanding tickets', () => {
  it('filters open tickets by service', () => {
    const rows = filterOutstandingTicketsForFunction(
      [
        ticket({ ticket_id: 'T1', service: 'HR', status: 'Open' }),
        ticket({ ticket_id: 'T2', service: 'IT', status: 'Open' }),
        ticket({ ticket_id: 'T3', service: 'HR', status: 'Resolved' }),
      ],
      'hr',
    );
    expect(rows.map((r) => r.ticket_id)).toEqual(['T1']);
    expect(rows[0]?.href).toBe('/shared-services/tickets/T1');
  });
});
