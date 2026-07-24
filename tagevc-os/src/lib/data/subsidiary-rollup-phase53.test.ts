import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  emptySubsidiaryRollupPhase53Report,
  mergeLiveRecruitFeedIntoReport,
  PHASE53_RECRUIT_ENTITY_ID,
  PHASE53_RECRUIT_PORTAL_BASE,
  PHASE53_SUBSIDIARY_ROLLUP_CONTRACT_VERSION,
  isRecruitRollupEntity,
} from './subsidiary-rollup-phase53';

const sqlPath = resolve(
  process.cwd(),
  'supabase/phase53_subsidiary_rollup_ops.sql',
);

describe('Phase 53 Subsidiary Rollup Hub (Recruit first)', () => {
  it('never mentions the retired os_store_snapshots identifier', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).not.toContain('os_store_snapshots');
  });

  it('adds append-only ENT-R619 snapshots + get/refresh RPCs with safe metadata', () => {
    const sql = readFileSync(sqlPath, 'utf8')
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sql).toContain(
      'create table if not exists public.os_subsidiary_rollup_phase53_snapshots',
    );
    expect(sql).toContain(
      'create table if not exists public.os_subsidiary_rollup_phase53_ops_alerts',
    );
    expect(sql).toContain('refresh_subsidiary_rollup_phase53');
    expect(sql).toContain('get_subsidiary_rollup_phase53_report');
    expect(sql).toContain('phase53_subsidiary_rollup_safe_detail');
    expect(sql).toContain("entity_id = 'ENT-R619'");
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('set search_path = public, extensions');
    expect(sql).toContain("'phase53-v1'");
    expect(sql).toContain('money_auto_approve');
    expect(sql).toContain('freshness');
    expect(sql).toContain('feed_status');
    expect(sql).toContain('portal.recruit619.com');
    expect(sql).toContain('Subsidiary rollup Phase 53 evidence is append-only');
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('fail-softs when Recruit feed tables are missing', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toContain('information_schema.tables');
    expect(sql).toContain('os_recruit_feed_metrics');
    expect(sql).toContain('recruiting_kpi_facts');
    expect(sql).toMatch(/TODO:\s*wire live Recruit portal feed/i);
    expect(sql).toContain("v_freshness := 'unknown'");
    expect(sql).toContain("v_feed := 'missing'");
  });

  it('is entity-scoped via RLS and can_access_entity', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toContain(
      'alter table public.os_subsidiary_rollup_phase53_snapshots enable row level security',
    );
    expect(sql).toContain('public.can_access_entity(entity_id)');
    expect(sql).toContain('public.is_firm_wide_access()');
    expect(sql).toMatch(
      /public\.get_subsidiary_rollup_phase53_report\(\s*\n?\s*text\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.refresh_subsidiary_rollup_phase53\(\s*\n?\s*uuid,\s*text\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
  });

  it('never auto-approves money', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toContain("'money_auto_approve', false");
    expect(sql).not.toMatch(/approve_marketing_dry_run_promote/i);
    expect(sql).not.toMatch(/money_auto_approve['")\s]*(=|,)\s*true/i);
  });

  it('empty stub report uses freshness=unknown and Recruit portal drill-downs', () => {
    const report = emptySubsidiaryRollupPhase53Report();
    expect(report.entity_id).toBe(PHASE53_RECRUIT_ENTITY_ID);
    expect(report.freshness).toBe('unknown');
    expect(report.feed_status).toBe('missing');
    expect(report.open_reqs).toBeNull();
    expect(report.placements).toBeNull();
    expect(report.money_auto_approve).toBe(false);
    expect(report.contract_version).toBe(
      PHASE53_SUBSIDIARY_ROLLUP_CONTRACT_VERSION,
    );
    expect(report.drill_downs.portal).toBe(PHASE53_RECRUIT_PORTAL_BASE);
    expect(report.todo.toLowerCase()).toContain('awaiting live recruit');
    expect(isRecruitRollupEntity(PHASE53_RECRUIT_ENTITY_ID)).toBe(true);
    expect(isRecruitRollupEntity('ENT-002')).toBe(false);
  });

  it('merges Phase 55 jsonb feed payload into Phase 53 metrics', () => {
    const merged = mergeLiveRecruitFeedIntoReport(
      emptySubsidiaryRollupPhase53Report(),
      {
        id: 'feed-1',
        as_of: new Date().toISOString(),
        source: 'recruit_portal',
        payload: {
          openJobs: 3,
          openApplications: 12,
          placementsStarted: 1,
          placementsPendingStart: 2,
          mode: 'live',
        },
      },
    );
    expect(merged.open_reqs).toBe(3);
    expect(merged.pipeline_volume).toBe(12);
    expect(merged.placements).toBe(1);
    expect(merged.feed_status).toBe('ok');
    expect(merged.freshness).toBe('fresh');
    expect(merged.snapshot_id).toBe('feed-1');
    expect(merged.todo.toLowerCase()).toContain('live recruit');
  });

  it('wires rollup into Entity OS (entities + ENT-R619 panel), not a new top-level module', () => {
    const lib = readFileSync(
      resolve(process.cwd(), 'src/lib/data/subsidiary-rollup-phase53.ts'),
      'utf8',
    );
    const entityOs = readFileSync(
      resolve(process.cwd(), 'src/lib/data/entity-os.ts'),
      'utf8',
    );
    const panel = readFileSync(
      resolve(process.cwd(), 'src/components/entity-os/entity-operating-view.tsx'),
      'utf8',
    );
    const sectionNav = readFileSync(
      resolve(process.cwd(), 'src/components/entity-os/entity-section-nav.tsx'),
      'utf8',
    );
    const entitiesPage = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/entities/page.tsx'),
      'utf8',
    );
    const nav = readFileSync(resolve(process.cwd(), 'src/lib/nav.ts'), 'utf8');
    const actions = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/entities/actions.ts'),
      'utf8',
    );

    expect(lib).toContain('getSubsidiaryRollupPhase53Report');
    expect(lib).toContain('refreshSubsidiaryRollupPhase53');
    expect(lib).toContain('mergeLiveRecruitFeedIntoReport');
    expect(lib).toContain('os_recruit_feed_metrics');
    expect(lib).toContain(PHASE53_SUBSIDIARY_ROLLUP_CONTRACT_VERSION);

    expect(entityOs).toContain('getSubsidiaryRollupPhase53Report');
    expect(entityOs).toContain('subsidiary_rollup');
    expect(panel).toContain('Company performance summary');
    expect(panel).toContain('id="rollup"');
    expect(panel).toContain('portal.recruit619.com');
    expect(sectionNav).toContain('rollup');
    expect(entitiesPage).toContain('ENT-R619');
    expect(entitiesPage).toContain('performance rollup');
    expect(nav).toContain('/entities');
    expect(nav).toContain('Entities');
    expect(nav).toContain('Dashboard');
    expect(nav).not.toContain('Recruit 619 Rollup');
    expect(actions).toContain('refreshSubsidiaryRollupPhase53Action');
  });
});
