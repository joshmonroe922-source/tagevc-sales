import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Help Desk ticket seeding', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete (globalThis as { __tageTicketStore?: unknown }).__tageTicketStore;
    vi.resetModules();
  });

  it('seeds TK-001–TK-005 under NODE_ENV=test', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    delete process.env.SEED_HELP_DESK_TICKETS;
    const { getTicketStore, shouldSeedHelpDeskTickets, isDemoSeedTicket } =
      await import('./ticket-store');
    expect(shouldSeedHelpDeskTickets()).toBe(true);
    expect(isDemoSeedTicket('TK-001')).toBe(true);
    const store = getTicketStore();
    expect(store.tickets.map((t) => t.ticket_id)).toEqual([
      'TK-001',
      'TK-002',
      'TK-003',
      'TK-004',
      'TK-005',
    ]);
  });

  it('starts empty when seed flag is off (production-like)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.SEED_HELP_DESK_TICKETS;
    const { getTicketStore, shouldSeedHelpDeskTickets } =
      await import('./ticket-store');
    expect(shouldSeedHelpDeskTickets()).toBe(false);
    expect(getTicketStore().tickets).toEqual([]);
    expect(getTicketStore().audits).toEqual([]);
  });

  it('seeds when SEED_HELP_DESK_TICKETS=1 outside test', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SEED_HELP_DESK_TICKETS', '1');
    const { getTicketStore, shouldSeedHelpDeskTickets } =
      await import('./ticket-store');
    expect(shouldSeedHelpDeskTickets()).toBe(true);
    expect(getTicketStore().tickets).toHaveLength(5);
  });
});
