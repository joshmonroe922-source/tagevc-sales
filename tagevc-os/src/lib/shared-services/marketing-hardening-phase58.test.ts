import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PHASE58_ENTITY_FILTER_HINT,
  PHASE58_MARKETING_CONTRACT_VERSION,
  boardStatusLabel,
  emptyMarketingHardeningPhase58Report,
  formatReliabilityPct,
  publishActionLabel,
} from './marketing-hardening-phase58';

const sqlPath = resolve(
  process.cwd(),
  'supabase/phase58_marketing_hardening.sql',
);

describe('Phase 58 Marketing production hardening', () => {
  it('never mentions the retired os_store_snapshots identifier', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).not.toContain('os_store_snapshots');
  });

  it('adds append-only SLA/publish/voice/perf/recruit evidence + RPCs', () => {
    const sql = readFileSync(sqlPath, 'utf8')
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sql).toContain(
      'create table if not exists public.os_marketing_approval_sla_phase58_snapshots',
    );
    expect(sql).toContain(
      'create table if not exists public.os_marketing_publishing_controls_phase58_events',
    );
    expect(sql).toContain(
      'create table if not exists public.os_marketing_brand_voice_phase58_enforcement',
    );
    expect(sql).toContain(
      'create table if not exists public.os_marketing_campaign_perf_phase58_snapshots',
    );
    expect(sql).toContain(
      'create table if not exists public.os_marketing_recruit_acquisition_phase58_events',
    );
    expect(sql).toContain(
      'create table if not exists public.os_marketing_publish_phase58_proposals',
    );
    expect(sql).toContain(
      'create table if not exists public.os_marketing_publish_phase58_approvals',
    );
    expect(sql).toContain('refresh_marketing_hardening_phase58');
    expect(sql).toContain('get_marketing_hardening_phase58_report');
    expect(sql).toContain('propose_marketing_publish_phase58');
    expect(sql).toContain('approve_marketing_publish_phase58');
    expect(sql).toContain('record_recruit_acquisition_intake_phase58');
    expect(sql).toContain('phase58_marketing_safe_detail');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('set search_path = public, extensions');
    expect(sql).toContain("'phase58-v1'");
    expect(sql).toContain('money_auto_approved');
    expect(sql).toContain('publish_executed');
    expect(sql).toContain('never_auto_approve_money');
    expect(sql).toContain('ENT-R619');
    expect(sql).toContain('appcast');
    expect(sql).toContain('careers');
    expect(sql).toContain('Marketing Phase 58 evidence is append-only');
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

  it('enforces publish dual-approve and never auto-approves money', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toContain(
      'Proposer may not also approve their own Phase 58 publish proposal',
    );
    expect(sql).toContain('v_distinct_approvers < 2');
    expect(sql).toContain('awaiting_second_approval');
    expect(sql).toContain('dual_approved');
    expect(sql).toContain("'money_auto_approved',false");
    expect(sql).toContain("'publish_executed',false");
    expect(sql).toContain('operator_must_execute_after_dual_approve');
    expect(sql).toContain('Never auto-approve money');
  });

  it('is entity-scoped via RLS and can_access_entity', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toContain(
      'alter table public.os_marketing_approval_sla_phase58_snapshots',
    );
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('public.can_access_entity(entity_id)');
    expect(sql).toContain('public.is_firm_wide_access()');
    expect(sql).toMatch(
      /public\.get_marketing_hardening_phase58_report\(\s*\n?\s*text\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.refresh_marketing_hardening_phase58\(\s*\n?\s*uuid,\s*text\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.propose_marketing_publish_phase58\(\s*\n?\s*jsonb\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.approve_marketing_publish_phase58\(\s*\n?\s*uuid,\s*uuid,\s*text,\s*jsonb\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
  });

  it('empty stub report never auto-approves money and hints ENT-R619', () => {
    const report = emptyMarketingHardeningPhase58Report();
    expect(report.board_status).toBe('missing');
    expect(report.money_auto_approved).toBe(false);
    expect(report.publish_executed).toBe(false);
    expect(report.dual_approve_required).toBe(true);
    expect(report.never_auto_approve_money).toBe(true);
    expect(report.contract_version).toBe(PHASE58_MARKETING_CONTRACT_VERSION);
    expect(report.entity_filter_hint).toBe(PHASE58_ENTITY_FILTER_HINT);
    expect(report.recruit_feed_status).toBe('missing');
    expect(report.todo).toMatch(/Appcast|careers|ENT-R619/i);
    expect(formatReliabilityPct(null)).toBe('—');
    expect(formatReliabilityPct(95)).toBe('95%');
    expect(boardStatusLabel('partial')).toBe('Partial');
    expect(publishActionLabel('paid_publish')).toBe('Paid publish');
  });

  it('wires marketing page + Phase 58 panel + dual-approve actions', () => {
    const lib = readFileSync(
      resolve(
        process.cwd(),
        'src/lib/shared-services/marketing-hardening-phase58.ts',
      ),
      'utf8',
    );
    const server = readFileSync(
      resolve(
        process.cwd(),
        'src/lib/shared-services/marketing-hardening-phase58-server.ts',
      ),
      'utf8',
    );
    const page = readFileSync(
      resolve(
        process.cwd(),
        'src/app/(app)/shared-services/marketing/page.tsx',
      ),
      'utf8',
    );
    const actions = readFileSync(
      resolve(
        process.cwd(),
        'src/app/(app)/shared-services/marketing/actions.ts',
      ),
      'utf8',
    );
    const ui = readFileSync(
      resolve(
        process.cwd(),
        'src/components/shared-services/marketing-hardening-phase58-client.tsx',
      ),
      'utf8',
    );
    const modules = readFileSync(
      resolve(process.cwd(), 'src/lib/shared-services/modules.ts'),
      'utf8',
    );

    expect(lib).toContain(PHASE58_MARKETING_CONTRACT_VERSION);
    expect(lib).toContain('TODO');
    expect(lib).not.toContain('createPersistClient');

    expect(server).toContain('getMarketingHardeningPhase58Report');
    expect(server).toContain('proposeMarketingPublishPhase58');
    expect(server).toContain('approveMarketingPublishPhase58');
    expect(server).toContain('recordRecruitAcquisitionIntakePhase58');
    expect(server).toContain('createPersistClient');
    expect(server).toContain('money_auto_approved: false');
    expect(server).toContain('publish_executed: false');

    expect(page).toContain('MarketingHardeningPhase58Client');
    expect(page).toContain('getMarketingHardeningPhase58Report');
    expect(page).toContain('Phase 58');

    expect(actions).toContain('proposeMarketingPublishPhase58Action');
    expect(actions).toContain('approveMarketingPublishPhase58Action');
    expect(actions).toContain('refreshMarketingHardeningPhase58Action');
    expect(actions).toContain('money_auto_approved: false');
    expect(actions).toContain('dual_approve_required: true');

    expect(ui).toContain('Phase 58');
    expect(ui).toContain('dual');
    expect(ui).toContain('Never auto-approve money');
    expect(ui).toContain('ENT-R619');
    expect(ui).toContain('Appcast');
    expect(ui).toContain('Recruit acquisition');

    expect(modules).toContain("href: '/shared-services/marketing'");
    expect(modules).toContain('Phase 58');
    expect(modules).toContain("status: 'live'");
  });
});
