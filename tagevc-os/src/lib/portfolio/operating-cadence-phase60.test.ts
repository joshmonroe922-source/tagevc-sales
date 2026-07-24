import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PHASE60_ENTITY_FILTER_HINT,
  PHASE60_PORTFOLIO_CONTRACT_VERSION,
  boardStatusLabel,
  emptyPortfolioOperatingCadencePhase60Report,
  formatCompletenessPct,
  packetKindLabel,
  riskMilestoneLabel,
} from './operating-cadence-phase60';

const sqlPath = resolve(
  process.cwd(),
  'supabase/phase60_portfolio_operating_cadence.sql',
);

describe('Phase 60 portfolio operating cadence', () => {
  it('never mentions the retired os_store_snapshots identifier', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).not.toContain('os_store_snapshots');
  });

  it('adds append-only health/risk/packet/handoff/subsidiary evidence + RPCs', () => {
    const sql = readFileSync(sqlPath, 'utf8')
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sql).toContain(
      'create table if not exists public.os_portfolio_health_phase60_snapshots',
    );
    expect(sql).toContain(
      'create table if not exists public.os_portfolio_risk_milestone_phase60_events',
    );
    expect(sql).toContain(
      'create table if not exists public.os_portfolio_review_packet_phase60_events',
    );
    expect(sql).toContain(
      'create table if not exists public.os_portfolio_handoff_phase60_snapshots',
    );
    expect(sql).toContain(
      'create table if not exists public.os_portfolio_subsidiary_phase60_links',
    );
    expect(sql).toContain(
      'create table if not exists public.os_portfolio_phase60_ops_alerts',
    );
    expect(sql).toContain('record_portfolio_risk_milestone_phase60');
    expect(sql).toContain('record_portfolio_review_packet_phase60');
    expect(sql).toContain('refresh_portfolio_operating_cadence_phase60');
    expect(sql).toContain('get_portfolio_operating_cadence_phase60_report');
    expect(sql).toContain('phase60_portfolio_safe_detail');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('set search_path = public, extensions');
    expect(sql).toContain("'phase60-v1'");
    expect(sql).toContain('ENT-R619');
    expect(sql).toContain('ENT-INDA');
    expect(sql).toContain(
      'Portfolio operating cadence Phase 60 evidence is append-only',
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
      'alter table public.os_portfolio_health_phase60_snapshots',
    );
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('public.can_access_entity(entity_id)');
    expect(sql).toContain('public.is_firm_wide_access()');
    expect(sql).toMatch(
      /public\.get_portfolio_operating_cadence_phase60_report\(\s*\n?\s*text\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.refresh_portfolio_operating_cadence_phase60\(\s*\n?\s*uuid,\s*text\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.record_portfolio_risk_milestone_phase60\(\s*\n?\s*jsonb\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.record_portfolio_review_packet_phase60\(\s*\n?\s*jsonb\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
  });

  it('empty stub report keeps weekly cadence and hints ENT-R619', () => {
    const report = emptyPortfolioOperatingCadencePhase60Report();
    expect(report.board_status).toBe('missing');
    expect(report.weekly_cadence).toBe(true);
    expect(report.contract_version).toBe(PHASE60_PORTFOLIO_CONTRACT_VERSION);
    expect(report.entity_filter_hint).toBe(PHASE60_ENTITY_FILTER_HINT);
    expect(report.subsidiaries.some((s) => s.entity_id === 'ENT-R619')).toBe(
      true,
    );
    expect(report.subsidiaries.some((s) => s.entity_id === 'ENT-INDA')).toBe(
      true,
    );
    expect(boardStatusLabel('partial')).toBe('Partial');
    expect(formatCompletenessPct(null)).toBe('—');
    expect(formatCompletenessPct(80)).toBe('80%');
    expect(riskMilestoneLabel('milestone')).toBe('Milestone');
    expect(packetKindLabel('weekly_ops')).toBe('Weekly ops');
  });

  it('wires dashboard page, actions, server helpers, and Phase 60 panel', () => {
    const lib = readFileSync(
      resolve(process.cwd(), 'src/lib/portfolio/operating-cadence-phase60.ts'),
      'utf8',
    );
    const server = readFileSync(
      resolve(
        process.cwd(),
        'src/lib/portfolio/operating-cadence-phase60-server.ts',
      ),
      'utf8',
    );
    const page = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/dashboard/page.tsx'),
      'utf8',
    );
    const portfolioRedirect = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/portfolio/page.tsx'),
      'utf8',
    );
    const actions = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/portfolio/actions.ts'),
      'utf8',
    );
    const ui = readFileSync(
      resolve(
        process.cwd(),
        'src/components/portfolio/operating-cadence-phase60-client.tsx',
      ),
      'utf8',
    );

    expect(lib).toContain(PHASE60_PORTFOLIO_CONTRACT_VERSION);
    expect(lib).toContain('TODO');
    expect(lib).not.toContain('createPersistClient');

    expect(server).toContain('getPortfolioOperatingCadencePhase60Report');
    expect(server).toContain('refreshPortfolioOperatingCadencePhase60');
    expect(server).toContain('recordPortfolioRiskMilestonePhase60');
    expect(server).toContain('recordPortfolioReviewPacketPhase60');
    expect(server).toContain('createPersistClient');
    expect(server).toContain('weekly_cadence: true');

    expect(page).toContain('OperatingCadencePhase60Client');
    expect(page).toContain('getPortfolioOperatingCadencePhase60Report');
    expect(portfolioRedirect).toContain("redirect('/dashboard')");

    expect(actions).toContain('refreshPortfolioOperatingCadencePhase60Action');
    expect(actions).toContain('recordPortfolioRiskMilestonePhase60Action');
    expect(actions).toContain('recordPortfolioReviewPacketPhase60Action');
    expect(actions).toContain('PHASE60_PORTFOLIO_CONTRACT_VERSION');

    expect(ui).toContain('Phase 60');
    expect(ui).toContain('ENT-R619');
    expect(ui).toContain('weekly_cadence');
    expect(ui).toContain('Handoff completeness');
  });
});
