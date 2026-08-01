import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PHASE57_ENTITY_FILTER_HINT,
  PHASE57_HR_IT_CONTRACT_VERSION,
  boardStatusLabel,
  emptyHrItHardeningPhase57Report,
  formatCompletenessPct,
  highRiskActionLabel,
} from './hr-it-hardening-phase57';

const sqlPath = resolve(
  process.cwd(),
  'supabase/phase57_hr_it_hardening.sql',
);

describe('Phase 57 HR + IT production hardening', () => {
  it('never mentions the retired os_store_snapshots identifier', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).not.toContain('os_store_snapshots');
  });

  it('adds append-only run/assignment/revocation/aging/inbox evidence + RPCs', () => {
    const sql = readFileSync(sqlPath, 'utf8')
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sql).toContain(
      'create table if not exists public.os_hr_it_run_completeness_phase57_snapshots',
    );
    expect(sql).toContain(
      'create table if not exists public.os_hr_it_assignment_visibility_phase57_events',
    );
    expect(sql).toContain(
      'create table if not exists public.os_hr_it_access_revocation_phase57_evidence',
    );
    expect(sql).toContain(
      'create table if not exists public.os_hr_it_exception_aging_phase57_alerts',
    );
    expect(sql).toContain(
      'create table if not exists public.os_hr_it_escalation_phase57_events',
    );
    expect(sql).toContain(
      'create table if not exists public.os_hr_it_high_risk_phase57_proposals',
    );
    expect(sql).toContain(
      'create table if not exists public.os_hr_it_high_risk_phase57_approvals',
    );
    expect(sql).toContain(
      'create table if not exists public.os_hr_it_dual_approve_inbox_phase57_snapshots',
    );
    expect(sql).toContain(
      'create table if not exists public.os_hr_it_subsidiary_phase57_events',
    );
    expect(sql).toContain('refresh_hr_it_hardening_phase57');
    expect(sql).toContain('get_hr_it_hardening_phase57_report');
    expect(sql).toContain('propose_hr_it_high_risk_phase57');
    expect(sql).toContain('approve_hr_it_high_risk_phase57');
    expect(sql).toContain('record_hr_it_escalation_phase57');
    expect(sql).toContain('list_hr_it_dual_approve_inbox_phase57');
    expect(sql).toContain('phase57_hr_it_safe_detail');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('set search_path = public, extensions');
    expect(sql).toContain("'phase57-v1'");
    expect(sql).toContain('breaker_auto_closed');
    expect(sql).toContain('access_revoke_executed');
    expect(sql).toContain('never_auto_close_breakers');
    expect(sql).toContain('ENT-R619');
    expect(sql).toContain('ENT-INDA');
    expect(sql).toContain('os_identity_lifecycle_runs');
    expect(sql).toContain('list_it_intune_dual_approve_inbox_phase51');
    expect(sql).toContain('HR + IT Phase 57 evidence is append-only');
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

  it('enforces high-risk dual-approve and never auto-closes breakers', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toContain(
      'Proposer may not also approve their own Phase 57 high-risk proposal',
    );
    expect(sql).toContain('v_distinct_approvers < 2');
    expect(sql).toContain('awaiting_second_approval');
    expect(sql).toContain('dual_approved');
    expect(sql).toContain("'breaker_auto_closed',false");
    expect(sql).toContain("'access_revoke_executed',false");
    expect(sql).toContain('operator_must_execute_after_dual_approve');
    expect(sql).toContain('Never auto-close breakers');
  });

  it('is entity-scoped via RLS and can_access_entity', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toContain(
      'alter table public.os_hr_it_run_completeness_phase57_snapshots',
    );
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('public.can_access_entity(entity_id)');
    expect(sql).toContain('public.is_firm_wide_access()');
    expect(sql).toMatch(
      /public\.get_hr_it_hardening_phase57_report\(\s*\n?\s*text\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.refresh_hr_it_hardening_phase57\(\s*\n?\s*uuid,\s*text\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.propose_hr_it_high_risk_phase57\(\s*\n?\s*jsonb\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.approve_hr_it_high_risk_phase57\(\s*\n?\s*uuid,\s*uuid,\s*text,\s*jsonb\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
  });

  it('empty stub report never auto-closes breakers and hints ENT-R619', () => {
    const report = emptyHrItHardeningPhase57Report();
    expect(report.board_status).toBe('missing');
    expect(report.breaker_auto_closed).toBe(false);
    expect(report.access_revoke_executed).toBe(false);
    expect(report.dual_approve_required).toBe(true);
    expect(report.never_auto_close_breakers).toBe(true);
    expect(report.contract_version).toBe(PHASE57_HR_IT_CONTRACT_VERSION);
    expect(report.entity_filter_hint).toBe(PHASE57_ENTITY_FILTER_HINT);
    expect(report.subsidiaries.some((s) => s.entity_id === 'ENT-R619')).toBe(
      true,
    );
    expect(report.subsidiaries.some((s) => s.entity_id === 'ENT-INDA')).toBe(
      true,
    );
    expect(formatCompletenessPct(null)).toBe('—');
    expect(formatCompletenessPct(90)).toBe('90%');
    expect(boardStatusLabel('partial')).toBe('Partial');
    expect(highRiskActionLabel('breaker_close')).toBe('Breaker close');
  });

  it('wires HR page + IT assets Phase 57 panels + dual-approve actions', () => {
    const lib = readFileSync(
      resolve(process.cwd(), 'src/lib/shared-services/hr-it-hardening-phase57.ts'),
      'utf8',
    );
    const server = readFileSync(
      resolve(
        process.cwd(),
        'src/lib/shared-services/hr-it-hardening-phase57-server.ts',
      ),
      'utf8',
    );
    const hrPage = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/shared-services/hr/page.tsx'),
      'utf8',
    );
    const actions = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/shared-services/hr/actions.ts'),
      'utf8',
    );
    const itPage = readFileSync(
      resolve(
        process.cwd(),
        'src/app/(app)/shared-services/it/assets/page.tsx',
      ),
      'utf8',
    );
    const ui = readFileSync(
      resolve(
        process.cwd(),
        'src/components/shared-services/hr-it-hardening-phase57-client.tsx',
      ),
      'utf8',
    );
    const inboxUi = readFileSync(
      resolve(
        process.cwd(),
        'src/components/shared-services/it-assets-client.tsx',
      ),
      'utf8',
    );
    const modules = readFileSync(
      resolve(process.cwd(), 'src/lib/shared-services/modules.ts'),
      'utf8',
    );

    expect(lib).toContain(PHASE57_HR_IT_CONTRACT_VERSION);
    expect(lib).toContain('TODO');
    expect(lib).not.toContain('createPersistClient');

    expect(server).toContain('getHrItHardeningPhase57Report');
    expect(server).toContain('proposeHrItHighRiskPhase57');
    expect(server).toContain('approveHrItHighRiskPhase57');
    expect(server).toContain('createPersistClient');
    expect(server).toContain('breaker_auto_closed: false');
    expect(server).toContain('access_revoke_executed: false');

    expect(hrPage).toContain('HrItHardeningPhase57Client');
    expect(hrPage).toContain('getHrItHardeningPhase57Report');
    expect(hrPage).toContain("surface=\"hr\"");

    expect(actions).toContain('proposeHrItHighRiskPhase57Action');
    expect(actions).toContain('approveHrItHighRiskPhase57Action');
    expect(actions).toContain('breaker_auto_closed: false');
    expect(actions).toContain('dual_approve_required: true');

    expect(itPage).toContain('HrItHardeningPhase57Client');
    expect(itPage).toContain('getHrItHardeningPhase57Report');
    expect(itPage).toContain("surface=\"it\"");
    expect(ui).toContain('dual');
    expect(ui).toContain('Never auto-close breakers');
    expect(ui).toContain('Recruit 619');
    expect(ui).toContain('Intune dual-approve inbox');

    expect(inboxUi).toMatch(/Phase 57 aging/i);
    expect(inboxUi).toContain('stale');
    expect(inboxUi).toContain('critical');
    expect(inboxUi).toContain('never auto-closes breakers');

    expect(modules).toContain("href: '/shared-services/hr'");
    expect(modules).toContain("status: 'live'");
  });
});
