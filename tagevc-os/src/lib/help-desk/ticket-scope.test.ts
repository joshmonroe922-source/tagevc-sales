import { describe, expect, it } from 'vitest';

import {
  HELP_DESK_SOURCE_REF,
  isHelpDeskTicket,
} from '@/lib/help-desk/ticket-scope';

describe('isHelpDeskTicket', () => {
  it('keeps tagged help desk and ordinary requester tickets', () => {
    expect(
      isHelpDeskTicket({
        title: 'VPN access',
        source_ref: HELP_DESK_SOURCE_REF,
        requester_name: 'Josh',
      }),
    ).toBe(true);
    expect(
      isHelpDeskTicket({
        title: 'Printer offline',
        requester_name: 'Associate',
      }),
    ).toBe(true);
    expect(
      isHelpDeskTicket({
        title: '[R619] Need candidate dossier',
        requester_name: 'Recruit 619 Portal',
      }),
    ).toBe(true);
  });

  it('strips SSC checklist escalations and automation', () => {
    expect(
      isHelpDeskTicket({
        title: '[SSC overdue] Month-end bank rec',
        requester_name: 'SSC automation',
        source_ref: 'ssc_checklist',
      }),
    ).toBe(false);
    expect(
      isHelpDeskTicket({
        title: '[SSC overdue] Month-end bank rec',
        requester_name: 'SSC automation',
        links: '/shared-services/checklists',
        description:
          'Auto-escalated from Shared Services Center checklist (Phase 66/67).',
      }),
    ).toBe(false);
  });

  it('strips HRIS cadence and AI document follow-ups', () => {
    expect(
      isHelpDeskTicket({
        title: '[HRIS overdue] Collect I-9',
        requester_name: 'HRIS cadence',
        source_ref: 'hris_escalate',
      }),
    ).toBe(false);
    expect(
      isHelpDeskTicket({
        title: '[AI] Contract expires soon',
        ai_generated: true,
        source_doc_id: 'DOC-1',
        source_ref: 'ai_document',
      }),
    ).toBe(false);
  });
});
