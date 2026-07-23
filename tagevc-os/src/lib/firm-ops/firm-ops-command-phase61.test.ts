import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PHASE61_ENTITY_FILTER_HINT,
  PHASE61_FIRM_OPS_CONTRACT_VERSION,
  audienceLabel,
  boardStatusLabel,
  emptyFirmOpsCommandPhase61Report,
  severityLabel,
} from './firm-ops-command-phase61';

const sqlPath = resolve(
  process.cwd(),
  'supabase/phase61_firm_ops_command.sql',
);

describe('Phase 61 firm ops command completeness', () => {
  it('never mentions the retired os_store_snapshots identifier', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).not.toContain('os_store_snapshots');
  });

  it('adds append-only alert/queue/stale/nav evidence + RPCs', () => {
    const sql = readFileSync(sqlPath, 'utf8')
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sql).toContain(
      'create table if not exists public.os_firm_ops_alert_phase61_snapshots',
    );
    expect(sql).toContain(
      'create table if not exists public.os_firm_ops_queue_phase61_snapshots',
    );
    expect(sql).toContain(
      'create table if not exists public.os_firm_ops_stale_breach_phase61_snapshots',
    );
    expect(sql).toContain(
      'create table if not exists public.os_firm_ops_module_nav_phase61_links',
    );
    expect(sql).toContain(
      'create table if not exists public.os_firm_ops_phase61_ops_alerts',
    );
    expect(sql).toContain('refresh_firm_ops_command_phase61');
    expect(sql).toContain('get_firm_ops_command_phase61_report');
    expect(sql).toContain('phase61_firm_ops_safe_detail');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('set search_path = public, extensions');
    expect(sql).toContain("'phase61-v1'");
    expect(sql).toContain('ENT-R619');
    expect(sql).toContain('money_auto_approve');
    expect(sql).toContain('visionary');
    expect(sql).toContain('service_lead');
    expect(sql).toContain(
      'Firm Ops command Phase 61 evidence is append-only',
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

  it('is entity-scoped via RLS and can_access_entity', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toContain(
      'alter table public.os_firm_ops_alert_phase61_snapshots',
    );
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('public.can_access_entity(entity_id)');
    expect(sql).toContain('public.is_firm_wide_access()');
    expect(sql).toMatch(
      /public\.get_firm_ops_command_phase61_report\(\s*\n?\s*text\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.refresh_firm_ops_command_phase61\(\s*\n?\s*uuid,\s*text\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
  });

  it('empty stub report keeps firm ops flags and hints ENT-R619', () => {
    const report = emptyFirmOpsCommandPhase61Report();
    expect(report.alert_board_status).toBe('missing');
    expect(report.firm_ops_command).toBe(true);
    expect(report.money_auto_approve).toBe(false);
    expect(report.contract_version).toBe(PHASE61_FIRM_OPS_CONTRACT_VERSION);
    expect(report.entity_filter_hint).toBe(PHASE61_ENTITY_FILTER_HINT);
    expect(report.modules.some((m) => m.module_key === 'recruit619')).toBe(
      true,
    );
    expect(report.modules.some((m) => m.href === '/portfolio')).toBe(true);
    expect(boardStatusLabel('partial')).toBe('Partial');
    expect(audienceLabel('coo')).toBe('COO');
    expect(severityLabel('critical')).toBe('Critical');
  });

  it('wires command center page, actions, server helpers, and Phase 61 panel', () => {
    const lib = readFileSync(
      resolve(process.cwd(), 'src/lib/firm-ops/firm-ops-command-phase61.ts'),
      'utf8',
    );
    const server = readFileSync(
      resolve(
        process.cwd(),
        'src/lib/firm-ops/firm-ops-command-phase61-server.ts',
      ),
      'utf8',
    );
    const page = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/command-center/page.tsx'),
      'utf8',
    );
    const actions = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/command-center/actions.ts'),
      'utf8',
    );
    const ui = readFileSync(
      resolve(
        process.cwd(),
        'src/components/firm-ops/firm-ops-command-phase61-client.tsx',
      ),
      'utf8',
    );

    expect(lib).toContain(PHASE61_FIRM_OPS_CONTRACT_VERSION);
    expect(lib).toContain('TODO');
    expect(lib).not.toContain('createPersistClient');

    expect(server).toContain('getFirmOpsCommandPhase61Report');
    expect(server).toContain('refreshFirmOpsCommandPhase61');
    expect(server).toContain('createPersistClient');
    expect(server).toContain('money_auto_approve: false');

    expect(page).toContain('FirmOpsCommandPhase61Client');
    expect(page).toContain('getFirmOpsCommandPhase61Report');
    expect(page).toContain('Module quick-nav');
    expect(page).toContain('/entities/ENT-R619');

    expect(actions).toContain('refreshFirmOpsCommandPhase61Action');
    expect(actions).toContain('PHASE61_FIRM_OPS_CONTRACT_VERSION');
    expect(actions).toContain('write:shared_services');

    expect(ui).toContain('Phase 61');
    expect(ui).toContain('ENT-R619');
    expect(ui).toContain('Action queues');
    expect(ui).toContain('Stale / breach board');
    expect(ui).toContain('Module quick-nav');
  });
});
