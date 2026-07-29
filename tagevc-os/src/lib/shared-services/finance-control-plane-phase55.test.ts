import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PHASE55_ENTITY_FILTER_HINT,
  PHASE55_FINANCE_CONTRACT_VERSION,
  closeStatusLabel,
  emptyFinanceControlPlanePhase55Report,
  formatFinanceMetric,
} from './finance-control-plane-phase55';

const sqlPath = resolve(
  process.cwd(),
  'supabase/phase55_finance_control_plane.sql',
);

describe('Phase 55 Finance Control Plane (IES orchestration)', () => {
  it('never mentions the retired os_store_snapshots identifier', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).not.toContain('os_store_snapshots');
  });

  it('adds append-only KPI/checklist/anomaly/write-back evidence + RPCs', () => {
    const sql = readFileSync(sqlPath, 'utf8')
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sql).toContain(
      'create table if not exists public.os_finance_kpi_phase55_snapshots',
    );
    expect(sql).toContain(
      'create table if not exists public.os_finance_close_checklist_phase55_events',
    );
    expect(sql).toContain(
      'create table if not exists public.os_finance_anomaly_phase55_alerts',
    );
    expect(sql).toContain(
      'create table if not exists public.os_finance_writeback_phase55_proposals',
    );
    expect(sql).toContain(
      'create table if not exists public.os_finance_writeback_phase55_approvals',
    );
    expect(sql).toContain('refresh_finance_control_plane_phase55');
    expect(sql).toContain('get_finance_control_plane_phase55_report');
    expect(sql).toContain('propose_finance_writeback_phase55');
    expect(sql).toContain('approve_finance_writeback_phase55');
    expect(sql).toContain('record_finance_close_checklist_event_phase55');
    expect(sql).toContain('phase55_finance_safe_detail');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('set search_path = public, extensions');
    expect(sql).toContain("'phase55-v1'");
    expect(sql).toContain('money_auto_approve');
    expect(sql).toContain('ies_write_executed');
    expect(sql).toContain('ENT-R619');
    expect(sql).toContain('ENT-INDA');
    expect(sql).toContain(
      'Finance control plane Phase 55 evidence is append-only',
    );
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('fail-softs when IES feed is missing and never auto-writes IES', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toContain('information_schema.tables');
    expect(sql).toContain('os_ies_finance_feed');
    expect(sql).toContain("v_feed := 'missing'");
    expect(sql).toMatch(/TODO:.*IES feed/i);
    expect(sql).toContain("'ies_write_executed', false");
    expect(sql).toContain("'money_auto_approve', false");
    expect(sql).toContain('operator_must_execute_in_ies');
    expect(sql).toContain('NEVER execute IES write');
  });

  it('enforces dual-approve write-back gate (proposer cannot self-approve)', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toContain(
      'Proposer may not also approve their own Phase 55 write-back proposal',
    );
    expect(sql).toContain('v_distinct_approvers < 2');
    expect(sql).toContain('awaiting_second_approval');
    expect(sql).toContain('dual_approved');
  });

  it('is entity-scoped via RLS and can_access_entity', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toContain(
      'alter table public.os_finance_kpi_phase55_snapshots enable row level security',
    );
    expect(sql).toContain('public.can_access_entity(entity_id)');
    expect(sql).toContain('public.is_firm_wide_access()');
    expect(sql).toMatch(
      /public\.get_finance_control_plane_phase55_report\(\s*\n?\s*text\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.refresh_finance_control_plane_phase55\(\s*\n?\s*uuid,\s*text\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.propose_finance_writeback_phase55\(\s*\n?\s*jsonb\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.approve_finance_writeback_phase55\(\s*\n?\s*uuid,\s*uuid,\s*text,\s*jsonb\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
  });

  it('empty stub report uses feed_status=missing and ENT-R619 hint', () => {
    const report = emptyFinanceControlPlanePhase55Report();
    expect(report.feed_status).toBe('missing');
    expect(report.cash_on_hand).toBeNull();
    expect(report.money_auto_approve).toBe(false);
    expect(report.ies_write_executed).toBe(false);
    expect(report.ies_system_of_record).toBe(true);
    expect(report.contract_version).toBe(PHASE55_FINANCE_CONTRACT_VERSION);
    expect(report.entity_filter_hint).toBe(PHASE55_ENTITY_FILTER_HINT);
    expect(report.subsidiaries.some((s) => s.entity_id === 'ENT-R619')).toBe(
      true,
    );
    expect(report.subsidiaries.some((s) => s.entity_id === 'ENT-INDA')).toBe(
      true,
    );
    expect(formatFinanceMetric(null)).toBe('—');
    expect(formatFinanceMetric(1200)).toContain('1,200');
    expect(closeStatusLabel('in_progress')).toBe('In progress');
  });

  it('wires Finance page + hub card + dual-approve actions', () => {
    const lib = readFileSync(
      resolve(
        process.cwd(),
        'src/lib/shared-services/finance-control-plane-phase55.ts',
      ),
      'utf8',
    );
    const server = readFileSync(
      resolve(
        process.cwd(),
        'src/lib/shared-services/finance-control-plane-phase55-server.ts',
      ),
      'utf8',
    );
    const page = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/shared-services/finance/page.tsx'),
      'utf8',
    );
    const actions = readFileSync(
      resolve(
        process.cwd(),
        'src/app/(app)/shared-services/finance/actions.ts',
      ),
      'utf8',
    );
    const ui = readFileSync(
      resolve(
        process.cwd(),
        'src/components/shared-services/finance-control-plane-client.tsx',
      ),
      'utf8',
    );
    const modules = readFileSync(
      resolve(process.cwd(), 'src/lib/shared-services/modules.ts'),
      'utf8',
    );

    expect(lib).toContain(PHASE55_FINANCE_CONTRACT_VERSION);
    expect(lib).toContain('TODO');
    expect(lib).not.toContain('createPersistClient');

    expect(server).toContain('getFinanceControlPlanePhase55Report');
    expect(server).toContain('proposeFinanceWritebackPhase55');
    expect(server).toContain('approveFinanceWritebackPhase55');
    expect(server).toContain('createPersistClient');
    expect(server).toContain('ies_write_executed: false');

    expect(page).toContain('redirect');
    expect(page).toContain('/shared-services/af/finance');
    expect(page).toContain('LegacyFinanceSunsetRedirect');

    expect(actions).toContain('proposeFinanceWritebackPhase55Action');
    expect(actions).toContain('approveFinanceWritebackPhase55Action');
    expect(actions).toContain('write:shared_services');
    expect(actions).toContain('money_auto_approve: false');
    expect(actions).toContain('ies_write_executed: false');

    // Client retained for potential embed; nav/home sunset redirects to A&F.
    expect(ui).toContain('FinanceControlPlaneClient');
    expect(ui).toContain('IES');
    expect(ui).toContain('portfolioBridge');

    expect(modules).toContain("href: '/shared-services/af'");
    expect(modules).not.toContain("href: '/shared-services/finance'");
    expect(modules).toContain("id: 'tage_vc_af'");
    expect(modules).toMatch(/id:\s*'tage_vc_af'[\s\S]*?status:\s*'live'/);
  });
});
