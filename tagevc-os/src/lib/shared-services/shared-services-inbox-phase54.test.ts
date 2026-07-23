import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Ticket } from '@/lib/types';
import {
  PHASE54_ENTITY_FILTER_HINT,
  PHASE54_SS_INBOX_CONTRACT_VERSION,
  buildRelatedLinks,
  buildUnifiedInboxRows,
  classifyTicketSla,
  emptySharedServicesInboxPhase54Report,
  slaStatusLabel,
} from './shared-services-inbox-phase54';

const sqlPath = resolve(
  process.cwd(),
  'supabase/phase54_shared_services_inbox_ops.sql',
);

function sampleTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    ticket_id: 'TK-TEST',
    title: 'Test ticket',
    description: null,
    desired_outcome: null,
    service: 'IT',
    priority: 'P2',
    status: 'Open',
    requester_name: 'Assoc',
    assignee_name: null,
    entity_id: 'ENT-R619',
    company_name: 'Recruit 619',
    links: null,
    sla_due_at: '2099-01-01',
    autonomy_band: 'DRAFT',
    confidence: 70,
    diagnose_reasoning: 'test',
    proposed_action: null,
    forbid_hits: [],
    on_allow_list: false,
    draft_approval: 'pending',
    recommendation: null,
    policy_version: 'v1',
    ai_generated: false,
    source_doc_id: null,
    ai_suggestion_id: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    resolved_at: null,
    ...overrides,
  };
}

describe('Phase 54 Shared Services Inbox Unification', () => {
  it('never mentions the retired os_store_snapshots identifier', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).not.toContain('os_store_snapshots');
  });

  it('adds append-only SLA/escalation evidence + get/refresh RPCs', () => {
    const sql = readFileSync(sqlPath, 'utf8')
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sql).toContain(
      'create table if not exists public.os_ss_inbox_phase54_snapshots',
    );
    expect(sql).toContain(
      'create table if not exists public.os_ss_inbox_phase54_escalations',
    );
    expect(sql).toContain(
      'create table if not exists public.os_ss_inbox_phase54_ops_alerts',
    );
    expect(sql).toContain('refresh_shared_services_inbox_phase54');
    expect(sql).toContain('get_shared_services_inbox_phase54_report');
    expect(sql).toContain('phase54_ss_inbox_safe_detail');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('set search_path = public, extensions');
    expect(sql).toContain("'phase54-v1'");
    expect(sql).toContain('money_auto_approve');
    expect(sql).toContain('ENT-R619');
    expect(sql).toContain('Shared Services inbox Phase 54 evidence is append-only');
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('fail-softs when ticket tables are missing and stubs Finance/HR pages', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toContain('information_schema.tables');
    expect(sql).toContain('os_tickets');
    expect(sql).toContain('ss_tickets');
    expect(sql).toMatch(/TODO:.*Finance\/HR/i);
    expect(sql).toContain("v_feed := 'missing'");
    expect(sql).toContain('Phase 55 Finance control plane');
    expect(sql).toContain('Phase 57 HR');
  });

  it('is entity-scoped via RLS and can_access_entity', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toContain(
      'alter table public.os_ss_inbox_phase54_snapshots enable row level security',
    );
    expect(sql).toContain('public.can_access_entity(entity_id)');
    expect(sql).toContain('public.is_firm_wide_access()');
    expect(sql).toMatch(
      /public\.get_shared_services_inbox_phase54_report\(\s*\n?\s*text,\s*text\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.refresh_shared_services_inbox_phase54\(\s*\n?\s*uuid,\s*text\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
  });

  it('never auto-approves money and leaves dual-approve untouched', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toContain("'money_auto_approve', false");
    expect(sql).not.toMatch(/approve_marketing_dry_run_promote/i);
    expect(sql).not.toMatch(/money_auto_approve['")\s]*(=|,)\s*true/i);
    expect(sql).toMatch(/Dual-approve gates remain untouched/i);
  });

  it('empty stub report uses feed_status=missing and ENT-R619 hint', () => {
    const report = emptySharedServicesInboxPhase54Report();
    expect(report.feed_status).toBe('missing');
    expect(report.open_total).toBe(0);
    expect(report.money_auto_approve).toBe(false);
    expect(report.contract_version).toBe(PHASE54_SS_INBOX_CONTRACT_VERSION);
    expect(report.entity_filter_hint).toBe(PHASE54_ENTITY_FILTER_HINT);
    expect(report.module_stubs.some((s) => s.service === 'Finance')).toBe(true);
    expect(report.module_stubs.some((s) => s.service === 'HR')).toBe(true);
    expect(report.todo.toLowerCase()).toContain('finance/hr');
  });

  it('classifies SLA and builds unified inbox with entity + service filters', () => {
    const now = Date.parse('2026-07-23T12:00:00.000Z');
    expect(
      classifyTicketSla(sampleTicket({ sla_due_at: '2026-07-20' }), now),
    ).toBe('breached');
    expect(
      classifyTicketSla(
        sampleTicket({ sla_due_at: '2026-07-23T18:00:00.000Z' }),
        now,
      ),
    ).toBe('due_soon');
    expect(
      classifyTicketSla(sampleTicket({ sla_due_at: '2099-01-01' }), now),
    ).toBe('ok');
    expect(classifyTicketSla(sampleTicket({ sla_due_at: null }), now)).toBe(
      'none',
    );
    expect(slaStatusLabel('breached')).toBe('Breached');

    const report = emptySharedServicesInboxPhase54Report();
    report.recent_escalations = [
      {
        ticket_id: 'TK-ESC',
        entity_id: 'ENT-R619',
        service: 'Legal',
        priority: 'P0',
        sla_status: 'escalated',
        owner_name: null,
        severity: 'critical',
        created_at: '2026-07-23T00:00:00.000Z',
      },
    ];

    const tickets = [
      sampleTicket({
        ticket_id: 'TK-ESC',
        service: 'Legal',
        priority: 'P0',
        autonomy_band: 'ESCALATE',
        entity_id: 'ENT-R619',
        assignee_name: 'Counsel',
      }),
      sampleTicket({
        ticket_id: 'TK-FIN',
        service: 'Finance',
        entity_id: 'ENT-001',
        title: 'Finance wire review',
      }),
      sampleTicket({
        ticket_id: 'TK-CLOSED',
        status: 'Closed',
      }),
    ];

    const recruitOnly = buildUnifiedInboxRows(tickets, report, {
      entityId: 'ENT-R619',
    });
    expect(recruitOnly).toHaveLength(1);
    expect(recruitOnly[0]?.ticket.ticket_id).toBe('TK-ESC');
    expect(recruitOnly[0]?.escalated).toBe(true);
    expect(recruitOnly[0]?.owner).toBe('Counsel');

    const financeOnly = buildUnifiedInboxRows(tickets, report, {
      service: 'Finance',
    });
    expect(financeOnly).toHaveLength(1);
    expect(financeOnly[0]?.module_todo?.toLowerCase()).toContain('phase 55');

    const related = buildRelatedLinks(
      sampleTicket({
        entity_id: 'ENT-R619',
        source_doc_id: 'DOC-1',
        links: 'https://portal.recruit619.com/jobs',
      }),
    );
    expect(related.some((l) => l.kind === 'entity')).toBe(true);
    expect(related.some((l) => l.kind === 'document')).toBe(true);
    expect(related.some((l) => l.kind === 'external')).toBe(true);
  });

  it('wires unified inbox into Shared Services hub page + modules stubs', () => {
    const lib = readFileSync(
      resolve(
        process.cwd(),
        'src/lib/shared-services/shared-services-inbox-phase54.ts',
      ),
      'utf8',
    );
    const page = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/shared-services/page.tsx'),
      'utf8',
    );
    const modules = readFileSync(
      resolve(process.cwd(), 'src/lib/shared-services/modules.ts'),
      'utf8',
    );
    const actions = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/shared-services/actions.ts'),
      'utf8',
    );
    const ui = readFileSync(
      resolve(
        process.cwd(),
        'src/components/shared-services/ss-unified-inbox.tsx',
      ),
      'utf8',
    );

    expect(lib).toContain('buildUnifiedInboxRows');
    expect(lib).toContain(PHASE54_SS_INBOX_CONTRACT_VERSION);
    expect(lib).toContain('TODO');
    expect(lib).not.toContain('createPersistClient');

    const serverLib = readFileSync(
      resolve(
        process.cwd(),
        'src/lib/shared-services/shared-services-inbox-phase54-server.ts',
      ),
      'utf8',
    );
    expect(serverLib).toContain('getSharedServicesInboxPhase54Report');
    expect(serverLib).toContain('refreshSharedServicesInboxPhase54');
    expect(serverLib).toContain('createPersistClient');

    expect(page).toContain('Phase 54');
    expect(page).toContain('getSharedServicesInboxPhase54Report');
    expect(page).toContain('SsUnifiedInbox');
    expect(page).toContain('listScopedTickets');
    expect(page).toContain('shared-services-inbox-phase54-server');

    expect(modules).toContain("id: 'finance'");
    expect(modules).toContain("id: 'hr'");
    expect(modules).toContain('Phase 55');
    expect(modules).toContain('getSsHubCardModules');

    expect(actions).toContain('refreshSharedServicesInboxPhase54Action');
    expect(ui).toContain('Phase 54');
    expect(ui).toContain('ENT-R619');
    expect(ui).toContain('sla_status');
    expect(ui).toContain('buildUnifiedInboxRows');
  });
});
