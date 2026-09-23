import { describe, expect, it } from 'vitest';

import {
  TECH_SUPPORT_TICKET_EMAIL,
  buildNewTicketNotice,
} from './notify-new-ticket-email';

describe('new ticket tech-support notice', () => {
  it('builds a copy of the ticket for techsupport@tagevc.com', () => {
    const notice = buildNewTicketNotice({
      ticket_id: 'TK-100',
      title: 'Laptop will not boot',
      description: 'Black screen after login.',
      desired_outcome: 'Working laptop today',
      service: 'IT',
      priority: 'P1',
      requester_name: 'Ginger Claremohr',
      company_name: 'Recruit 619',
      entity_id: 'ENT-R619',
      links: 'https://portal.recruit619.com/help-desk',
      source_system: 'recruit619',
      source_ref: 'help_desk',
    });

    expect(notice.to).toBe(TECH_SUPPORT_TICKET_EMAIL);
    expect(notice.subject).toBe('[P1] TK-100 · Laptop will not boot');
    expect(notice.text).toContain('Black screen after login.');
    expect(notice.text).toContain('Ginger Claremohr');
    expect(notice.text).toContain('Recruit 619');
    expect(notice.href).toBe(
      'https://app.tagevc.com/shared-services/tickets/TK-100',
    );
  });
});
