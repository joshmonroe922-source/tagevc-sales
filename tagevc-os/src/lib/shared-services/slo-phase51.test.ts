import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PHASE51_SLO_CONTRACT_VERSION } from './slo-phase51';

const sql = readFileSync(
  new URL('../../../supabase/phase51_slo_governance_ops.sql', import.meta.url),
  'utf8',
);
const repo = readFileSync(new URL('./slo-policy.ts', import.meta.url), 'utf8');
const phase51Lib = readFileSync(new URL('./slo-phase51.ts', import.meta.url), 'utf8');
const admin = readFileSync(
  new URL('../../components/shared-services/slo-policy-admin.tsx', import.meta.url),
  'utf8',
);
const actions = readFileSync(
  new URL('../../app/(app)/shared-services/actions.ts', import.meta.url),
  'utf8',
);
const evaluateRoute = readFileSync(
  new URL('../../app/api/ops/slo-evaluate/route.ts', import.meta.url),
  'utf8',
);
const hubPage = readFileSync(
  new URL('../../app/(app)/shared-services/page.tsx', import.meta.url),
  'utf8',
);

describe('Phase 51 SLO governance ops', () => {
  it('adds per-owner self-serve trend charts reusing Phase 50 WoW snapshots — no new tables', () => {
    expect(sql).toContain('list_slo_owner_digest_self_serve_trend_phase51');
    expect(sql).toContain('get_slo_phase51_owner_digest_report');
    expect(sql).toContain('os_slo_owner_digest_wow_trend_snapshots');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('set search_path = public, extensions');
    expect(sql).toContain('full_push');
    expect(sql).toContain("'phase51-v1'");
    expect(sql).not.toMatch(/create table/i);
    expect(sql).not.toMatch(/email\s+text/i);
    expect(sql).not.toMatch(/webhook_url\s+text/i);
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('is still pull-only / NOT a full push system: chart is only returned when opted in and requested', () => {
    expect(sql).toMatch(/if v_opted_in then/);
    expect(sql).toContain("'full_push',false");
    expect(sql).toContain("'chart_ready'");
    expect(sql).not.toMatch(/insert\s+into\s+public\.os_slo_handoff_digest_notifications/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.os_slo_digest_notification_deliveries/i);
  });

  it('only the owner or a firm-wide actor may view the trend chart, and firm-wide report requires firm-wide access', () => {
    expect(sql).toMatch(
      /only the owner or a firm-wide actor may view this trend chart/i,
    );
    expect(sql).toMatch(
      /firm-wide access required for slo phase 51 owner digest report/i,
    );
  });

  it('grants report execute to authenticated+service_role', () => {
    expect(sql).toMatch(
      /public\.list_slo_owner_digest_self_serve_trend_phase51\([\s\S]*?\)\s*\n?\s*to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.get_slo_phase51_owner_digest_report\(\)[\s\S]*?to authenticated, service_role/,
    );
  });

  it('wires processSloGovernancePhase51, admin UI, hub surface, and evaluate tick', () => {
    expect(repo).toContain('processSloGovernancePhase51');
    expect(repo).toContain('phase51Report');
    expect(phase51Lib).toContain('processSloGovernancePhase51');
    expect(phase51Lib).toContain(PHASE51_SLO_CONTRACT_VERSION);
    expect(phase51Lib).toContain('full_push');
    expect(admin).toContain('listSloOwnerDigestSelfServeTrendAction');
    expect(admin).toContain('phase51Report');
    expect(actions).toContain('listSloOwnerDigestSelfServeTrendAction');
    expect(evaluateRoute).toContain('processSloGovernancePhase51');
    expect(evaluateRoute.indexOf('processSloGovernancePhase50')).toBeLessThan(
      evaluateRoute.indexOf('processSloGovernancePhase51'),
    );
    expect(hubPage).toContain('SloPolicyAdmin');
  });

  it('contract version is phase51-v1', () => {
    expect(PHASE51_SLO_CONTRACT_VERSION).toBe('phase51-v1');
  });
});
