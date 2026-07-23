import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PHASE56_ENTITY_FILTER_HINT,
  PHASE56_LEGAL_CONTRACT_VERSION,
  emptyLegalHardeningPhase56Report,
  formatCompletenessPct,
  governanceStatusLabel,
  quarterlyStatusLabel,
} from './legal-hardening-phase56';

const sqlPath = resolve(
  process.cwd(),
  'supabase/phase56_legal_docusign_hardening.sql',
);

describe('Phase 56 Legal / DocuSign production hardening', () => {
  it('never mentions the retired os_store_snapshots identifier', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).not.toContain('os_store_snapshots');
  });

  it('adds append-only governance/capital/archive/quarterly evidence + RPCs', () => {
    const sql = readFileSync(sqlPath, 'utf8')
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sql).toContain(
      'create table if not exists public.os_docusign_template_gov_phase56_snapshots',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_capital_send_phase56_proposals',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_capital_send_phase56_approvals',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_integrity_phase56_alerts',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_quarterly_process_phase56_events',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_subsidiary_legal_phase56_events',
    );
    expect(sql).toContain('refresh_legal_docusign_hardening_phase56');
    expect(sql).toContain('get_legal_docusign_hardening_phase56_report');
    expect(sql).toContain('propose_capital_send_phase56');
    expect(sql).toContain('approve_capital_send_phase56');
    expect(sql).toContain('record_quarterly_process_phase56');
    expect(sql).toContain('phase56_legal_safe_detail');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('set search_path = public, extensions');
    expect(sql).toContain("'phase56-v1'");
    expect(sql).toContain('envelope_send_executed');
    expect(sql).toContain('never_silent_send');
    expect(sql).toContain('never_creates_voids_or_resends');
    expect(sql).toContain('ENT-R619');
    expect(sql).toContain('ENT-INDA');
    expect(sql).toContain(
      'Legal / DocuSign Phase 56 evidence is append-only',
    );
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('uses os_sha256_hex and avoids bare CASE inside IF conditions', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('set search_path = public, extensions');
    const withoutHelper = sql.replace(
      /create or replace function public\.os_sha256_hex[\s\S]*?\$\$;/,
      '',
    );
    expect(withoutHelper).not.toMatch(/encode\(digest\(/);
    expect(withoutHelper).not.toMatch(/\bdigest\s*\(/);
    const plpgsqlBodies = sql.split(/language plpgsql[\s\S]*?as \$\$/);
    for (const body of plpgsqlBodies.slice(1)) {
      const untilEnd = body.slice(0, body.indexOf('$$'));
      expect(untilEnd).not.toMatch(
        /\bif\b(?!\s+not\s+exists)[\s\S]{0,80}\bcase\s+when\b[\s\S]{0,60}\bthen\b/i,
      );
    }
  });

  it('enforces capital dual-approve and never silent-sends envelopes', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toContain(
      'Proposer may not also approve their own Phase 56 capital send proposal',
    );
    expect(sql).toContain('v_distinct_approvers < 2');
    expect(sql).toContain('awaiting_second_approval');
    expect(sql).toContain('dual_approved');
    expect(sql).toContain("'envelope_send_executed',false");
    expect(sql).toContain('operator_must_send_after_dual_approve');
    expect(sql).toContain('Never create/void/resend envelopes');
    expect(sql).not.toMatch(
      /\b(createEnvelopeFromTemplate|voidEnvelope|resendEnvelope)\b/,
    );
  });

  it('is entity-scoped via RLS and can_access_entity', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toContain(
      'alter table public.os_docusign_template_gov_phase56_snapshots enable row level security',
    );
    expect(sql).toContain('public.can_access_entity(entity_id)');
    expect(sql).toContain('public.is_firm_wide_access()');
    expect(sql).toMatch(
      /public\.get_legal_docusign_hardening_phase56_report\(\s*\n?\s*text\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.refresh_legal_docusign_hardening_phase56\(\s*\n?\s*uuid,\s*text\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.propose_capital_send_phase56\(\s*\n?\s*jsonb\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.approve_capital_send_phase56\(\s*\n?\s*uuid,\s*uuid,\s*text,\s*jsonb\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
  });

  it('empty stub report never silent-sends and hints ENT-R619', () => {
    const report = emptyLegalHardeningPhase56Report();
    expect(report.governance_status).toBe('missing');
    expect(report.envelope_send_executed).toBe(false);
    expect(report.never_silent_send).toBe(true);
    expect(report.never_creates_voids_or_resends).toBe(true);
    expect(report.contract_version).toBe(PHASE56_LEGAL_CONTRACT_VERSION);
    expect(report.entity_filter_hint).toBe(PHASE56_ENTITY_FILTER_HINT);
    expect(report.subsidiaries.some((s) => s.entity_id === 'ENT-R619')).toBe(
      true,
    );
    expect(report.subsidiaries.some((s) => s.entity_id === 'ENT-INDA')).toBe(
      true,
    );
    expect(formatCompletenessPct(null)).toBe('—');
    expect(formatCompletenessPct(90)).toBe('90%');
    expect(governanceStatusLabel('partial')).toBe('Partial');
    expect(quarterlyStatusLabel('in_progress')).toBe('In progress');
  });

  it('wires DocuSign hub Phase 56 panels + dual-approve capital actions', () => {
    const lib = readFileSync(
      resolve(process.cwd(), 'src/lib/docusign/legal-hardening-phase56.ts'),
      'utf8',
    );
    const server = readFileSync(
      resolve(
        process.cwd(),
        'src/lib/docusign/legal-hardening-phase56-server.ts',
      ),
      'utf8',
    );
    const page = readFileSync(
      resolve(
        process.cwd(),
        'src/app/(app)/shared-services/legal/docusign/page.tsx',
      ),
      'utf8',
    );
    const actions = readFileSync(
      resolve(
        process.cwd(),
        'src/app/(app)/shared-services/legal/docusign/actions.ts',
      ),
      'utf8',
    );
    const ui = readFileSync(
      resolve(
        process.cwd(),
        'src/components/shared-services/legal-hardening-phase56-client.tsx',
      ),
      'utf8',
    );
    const modules = readFileSync(
      resolve(process.cwd(), 'src/lib/shared-services/modules.ts'),
      'utf8',
    );

    expect(lib).toContain(PHASE56_LEGAL_CONTRACT_VERSION);
    expect(lib).toContain('TODO');
    expect(lib).not.toContain('createPersistClient');
    expect(lib).not.toMatch(
      /createEnvelopeFromTemplate|voidEnvelope|sendEnvelope/,
    );

    expect(server).toContain('getLegalHardeningPhase56Report');
    expect(server).toContain('proposeCapitalSendPhase56');
    expect(server).toContain('approveCapitalSendPhase56');
    expect(server).toContain('createPersistClient');
    expect(server).toContain('envelope_send_executed: false');
    expect(server).not.toMatch(
      /createEnvelopeFromTemplate|voidEnvelope|dispatchPreparedDocuSignSend/,
    );

    expect(page).toContain('LegalHardeningPhase56Client');
    expect(page).toContain('getLegalHardeningPhase56Report');
    expect(page).toContain('Phase 56');

    expect(actions).toContain('proposeCapitalSendPhase56Action');
    expect(actions).toContain('approveCapitalSendPhase56Action');
    expect(actions).toContain('action:docusign_capital');
    expect(actions).toContain('envelope_send_executed: false');
    expect(actions).toContain('never_silent_send: true');

    expect(ui).toContain('Phase 56');
    expect(ui).toContain('dual');
    expect(ui).toContain('Capital send');
    expect(ui).toContain('Archive integrity');
    expect(ui).toContain('ENT-R619');
    expect(ui).toContain('Never silent send');

    expect(modules).toContain("href: '/shared-services/legal/docusign'");
    expect(modules).toContain('Phase 56');
  });
});
