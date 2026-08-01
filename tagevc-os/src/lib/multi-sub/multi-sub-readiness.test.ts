import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_SUBSIDIARY_CODES,
  DEFAULT_ENTITY_POLICY,
  ENTITY_ALIASES,
  ENTITY_REGISTRY_SEED,
  entityIdsEquivalent,
  MS_P1_CONTRACT_VERSION,
  resolveCanonicalEntityId,
} from './entity-registry';
import {
  filterTicketsByEntityAndService,
  requireTicketEntityId,
  validateContextLinksForEntity,
  MS_P2_CONTRACT_VERSION,
  RECRUIT_CONTEXT_LINK_TYPES,
  INDA_CONTEXT_LINK_TYPES,
} from './ticketing';
import {
  decideCrossEntityMessage,
  DEFAULT_CHANNELS_BY_ENTITY,
  MS_P3_CONTRACT_VERSION,
  subsidiaryMessagesDeepLink,
} from './messaging';
import { buildSsOperatorBoard, ticketContextHeader, MS_P4_CONTRACT_VERSION } from './ss-operator';
import {
  assertLeaverRevokeFirst,
  defaultLifecycleChecklist,
  leaverRevokeOrder,
  MS_P5_CONTRACT_VERSION,
  summarizeLifecycleRuns,
} from './lifecycle';
import {
  buildMultiSubHealthFromTickets,
  MULTI_SUB_VERIFICATION_SCENARIOS,
  MS_P6_CONTRACT_VERSION,
} from './health';
import {
  signSubsidiaryToken,
  authorizeSubsidiaryTicketRequest,
} from './subsidiary-ticket-auth';
import type { Ticket } from '@/lib/types';

const sqlFiles = [
  'phase_ms_p1_entity_registry_policy.sql',
  'phase_ms_p2_ticketing_multi_entity.sql',
  'phase_ms_p3_messaging_multi_entity.sql',
  'phase_ms_p4_ss_operator_ux.sql',
  'phase_ms_p5_identity_lifecycle.sql',
  'phase_ms_p6_parent_health_verification.sql',
] as const;

function readSql(name: string): string {
  return readFileSync(resolve(process.cwd(), 'supabase', name), 'utf8');
}

function sampleTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    ticket_id: 'TK-TEST',
    title: 'Test',
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
    policy_version: 'v1_assist',
    ai_generated: false,
    source_doc_id: null,
    ai_suggestion_id: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    resolved_at: null,
    ...overrides,
  };
}

describe('Multi-subsidiary readiness P1–P6', () => {
  it('SQL spines never mention os_store_snapshots and use os_sha256_hex', () => {
    for (const file of sqlFiles) {
      const sql = readSql(file);
      expect(sql).not.toContain('os_store_snapshots');
      expect(sql).toContain('public.os_sha256_hex');
      expect(sql).toContain('set search_path = public, extensions');
      expect(sql).toContain('money_auto_approve');
      expect(sql).not.toMatch(/if\s+case\s+when/i);
      expect(sql).not.toMatch(/money_auto_approve['")\s]*(=|,)\s*true/i);
    }
  });

  it('P1 registers ENT-R619 + ENT-INDA with ENT-002 alias', () => {
    const sql = readSql('phase_ms_p1_entity_registry_policy.sql');
    expect(sql).toContain('os_entity_registry');
    expect(sql).toContain("'ENT-R619'");
    expect(sql).toContain("'ENT-INDA'");
    expect(sql).toContain("'ENT-002'");
    expect(sql).toContain('portal.recruit619.com');
    expect(sql).toMatch(/TODO:.*Instant NDA portal/i);
    expect(sql).toContain('os_entity_policy_audits');
    expect(sql).toContain('Entity policy audits are append-only');
    expect(resolveCanonicalEntityId('ENT-002')).toBe('ENT-INDA');
    expect(entityIdsEquivalent('ENT-002', 'ENT-INDA')).toBe(true);
    expect(ENTITY_ALIASES['ENT-002']).toBe('ENT-INDA');
    expect(CANONICAL_SUBSIDIARY_CODES).toContain('ENT-R619');
    expect(CANONICAL_SUBSIDIARY_CODES).toContain('ENT-INDA');
    expect(
      ENTITY_REGISTRY_SEED.some((e) => e.entity_code === 'ENT-INDA'),
    ).toBe(true);
    expect(DEFAULT_ENTITY_POLICY.contract_version).toBe(MS_P1_CONTRACT_VERSION);
    expect(DEFAULT_ENTITY_POLICY.money_auto_approve).toBe(false);
  });

  it('P2 fail-closes ticket entity_id and validates context links', () => {
    expect(requireTicketEntityId(null).ok).toBe(false);
    expect(requireTicketEntityId('ENT-002')).toEqual({
      ok: true,
      entity_id: 'ENT-INDA',
    });
    expect(requireTicketEntityId('ENT-R619')).toEqual({
      ok: true,
      entity_id: 'ENT-R619',
    });
    expect(
      validateContextLinksForEntity('ENT-R619', [
        { link_type: 'r619_job', external_ref: 'JOB-1' },
      ]).ok,
    ).toBe(true);
    expect(
      validateContextLinksForEntity('ENT-INDA', [
        { link_type: 'r619_job', external_ref: 'JOB-1' },
      ]).ok,
    ).toBe(false);
    expect(RECRUIT_CONTEXT_LINK_TYPES.length).toBe(6);
    expect(INDA_CONTEXT_LINK_TYPES.length).toBe(5);
    const filtered = filterTicketsByEntityAndService(
      [
        sampleTicket({ entity_id: 'ENT-002' }),
        sampleTicket({ entity_id: 'ENT-R619', ticket_id: 'TK-2' }),
      ],
      { entityId: 'ENT-INDA' },
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].entity_id).toBe('ENT-002');
    const sql = readSql('phase_ms_p2_ticketing_multi_entity.sql');
    expect(sql).toContain('list_entity_tickets_ms_p2');
    expect(sql).toContain('get_ticket_status_ms_p2');
    expect(sql).toContain('inda_support_case');
    expect(sql).toContain('r619_placement');
    expect(MS_P2_CONTRACT_VERSION).toBe('ms-p2-v1');
  });

  it('P3 messaging policy + default channels + deeplinks', () => {
    expect(
      decideCrossEntityMessage({
        actorEntityId: 'ENT-R619',
        peerEntityId: 'ENT-INDA',
        kind: 'dm',
      }).allowed,
    ).toBe(true);
    expect(
      decideCrossEntityMessage({
        actorEntityId: 'ENT-R619',
        peerEntityId: 'ENT-INDA',
        kind: 'channel',
      }).allowed,
    ).toBe(false);
    expect(DEFAULT_CHANNELS_BY_ENTITY['ENT-R619']?.length).toBeGreaterThan(0);
    expect(DEFAULT_CHANNELS_BY_ENTITY['ENT-INDA']?.length).toBeGreaterThan(0);
    const deeplink = subsidiaryMessagesDeepLink('ENT-INDA');
    expect(deeplink.portal_messages).toContain('instantnda');
    expect(subsidiaryMessagesDeepLink('ENT-SIGNENT').todo).toMatch(/TODO/i);
    expect(subsidiaryMessagesDeepLink('ENT-R619').portal_messages).toContain(
      'portal.recruit619.com',
    );
    const sql = readSql('phase_ms_p3_messaging_multi_entity.sql');
    expect(sql).toContain('provision_messaging_membership_ms_p3');
    expect(sql).toContain('deprovision_messaging_membership_ms_p3');
    expect(sql).toContain('can_cross_entity_message_ms_p3');
    expect(sql).toContain('list_directory_with_entity_badges_ms_p3');
    expect(MS_P3_CONTRACT_VERSION).toBe('ms-p3-v1');
  });

  it('P4 operator board separates parent vs subsidiary', () => {
    const board = buildSsOperatorBoard([
      sampleTicket({ entity_id: 'ENT-FIRM', service: 'Finance' }),
      sampleTicket({ entity_id: 'ENT-R619', ticket_id: 'TK-2' }),
      sampleTicket({ entity_id: 'ENT-INDA', ticket_id: 'TK-3', service: 'Legal' }),
    ]);
    expect(board.parent_open).toBe(1);
    expect(board.subsidiary_open).toBe(2);
    expect(board.money_auto_approve).toBe(false);
    expect(board.contract_version).toBe(MS_P4_CONTRACT_VERSION);
    const header = ticketContextHeader(
      sampleTicket({ entity_id: 'ENT-002', ticket_id: 'TK-9' }),
    );
    expect(header.scope).toBe('subsidiary');
    expect(header.entity_code).toBe('ENT-INDA');
    const sql = readSql('phase_ms_p4_ss_operator_ux.sql');
    expect(sql).toContain('get_ss_operator_board_ms_p4');
    expect(sql).toContain('SS operator board snapshots are append-only');
  });

  it('P5 lifecycle joiner/mover/leaver revoke-first for R619 and INDA', () => {
    const joiner = defaultLifecycleChecklist('joiner', 'ENT-R619');
    const leaver = defaultLifecycleChecklist('leaver', 'ENT-INDA');
    expect(joiner.some((s) => s.id === 'provision_messaging')).toBe(true);
    expect(leaver[0].id).toBe('revoke_portal');
    expect(assertLeaverRevokeFirst(['revoke_messaging']).ok).toBe(false);
    expect(
      assertLeaverRevokeFirst(['revoke_portal', 'revoke_messaging']).ok,
    ).toBe(true);
    expect(leaverRevokeOrder()[0]).toBe('revoke_portal');
    const summary = summarizeLifecycleRuns([
      { status: 'needs_retry', checklist: [{ id: 'x', label: 'x', status: 'failed' }] },
      { status: 'completed', checklist: [] },
    ]);
    expect(summary.needs_retry).toBe(1);
    expect(summary.completed).toBe(1);
    expect(summary.failed_steps).toBe(1);
    expect(summary.contract_version).toBe(MS_P5_CONTRACT_VERSION);
    const sql = readSql('phase_ms_p5_identity_lifecycle.sql');
    expect(sql).toContain('start_identity_lifecycle_ms_p5');
    expect(sql).toContain('list_identity_lifecycle_control_center_ms_p5');
    expect(sql).toContain('revoke-first');
  });

  it('P6 health + eight verification scenarios', () => {
    expect(MULTI_SUB_VERIFICATION_SCENARIOS).toHaveLength(8);
    const health = buildMultiSubHealthFromTickets([
      sampleTicket({ entity_id: 'ENT-R619', priority: 'P0' }),
      sampleTicket({
        entity_id: 'ENT-002',
        ticket_id: 'TK-2',
        sla_due_at: '2020-01-01',
      }),
    ]);
    expect(health.ticket_volume_by_entity['ENT-R619']).toBe(1);
    expect(health.ticket_volume_by_entity['ENT-INDA']).toBe(1);
    expect(health.ticket_sla_by_entity['ENT-INDA']?.breached).toBe(1);
    expect(health.money_auto_approve).toBe(false);
    expect(health.contract_version).toBe(MS_P6_CONTRACT_VERSION);
    const sql = readSql('phase_ms_p6_parent_health_verification.sql');
    expect(sql).toContain('get_multi_sub_health_ms_p6');
    expect(sql).toContain('record_multi_sub_verification_ms_p6');
    expect(sql).toContain('Multi-sub health snapshots are append-only');
  });

  it('subsidiary signed token auth is least-privilege per entity', async () => {
    process.env.SUBSIDIARY_API_SECRET = 'test-sub-secret-xyz';
    const token = signSubsidiaryToken({
      clientId: 'recruit619_portal',
      entityId: 'ENT-R619',
      expUnix: Math.floor(Date.now() / 1000) + 3600,
      secret: 'test-sub-secret-xyz',
    });
    const okReq = new Request('https://app.tagevc.com/api/subsidiary/tickets', {
      headers: { authorization: `Bearer ${token}` },
    });
    const ok = await authorizeSubsidiaryTicketRequest(okReq, 'tickets:read');
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.client.entity_id).toBe('ENT-R619');

    const bad = signSubsidiaryToken({
      clientId: 'recruit619_portal',
      entityId: 'ENT-INDA',
      expUnix: Math.floor(Date.now() / 1000) + 3600,
      secret: 'test-sub-secret-xyz',
    });
    const badReq = new Request('https://app.tagevc.com/api/subsidiary/tickets', {
      headers: { authorization: `Bearer ${bad}` },
    });
    const denied = await authorizeSubsidiaryTicketRequest(badReq, 'tickets:read');
    expect(denied.ok).toBe(false);
  });

  it('API route + UI wiring files exist for subsidiary tickets and operator panels', () => {
    const ticketApi = readFileSync(
      resolve(process.cwd(), 'src/app/api/subsidiary/tickets/route.ts'),
      'utf8',
    );
    expect(ticketApi).toContain('authorizeSubsidiaryTicketRequest');
    expect(ticketApi).toContain('requireTicketEntityId');
    expect(ticketApi).toContain('diagnose_preserved');
    const lifeApi = readFileSync(
      resolve(process.cwd(), 'src/app/api/identity/lifecycle/route.ts'),
      'utf8',
    );
    expect(lifeApi).toContain('start_identity_lifecycle_ms_p5');
    const panels = readFileSync(
      resolve(
        process.cwd(),
        'src/components/shared-services/ss-multi-sub-operator-panels.tsx',
      ),
      'utf8',
    );
    expect(panels).toContain('Multi-subsidiary operator board');
    const page = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/shared-services/page.tsx'),
      'utf8',
    );
    expect(page).toContain('SsMultiSubOperatorPanels');
    const messagesActions = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/messages/actions.ts'),
      'utf8',
    );
    expect(messagesActions).toContain('can_cross_entity_message_ms_p3');
    expect(messagesActions).toContain('decideCrossEntityMessage');
    const mw = readFileSync(
      resolve(process.cwd(), 'src/lib/supabase/middleware.ts'),
      'utf8',
    );
    expect(mw).toContain("/api/subsidiary/tickets");
    expect(mw).toContain("/api/identity/lifecycle");
    expect(mw).toContain("/api/finance/ies/snapshot");
    expect(mw).toContain("/api/presence");
  });
});
