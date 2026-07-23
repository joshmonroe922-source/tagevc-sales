import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PHASE52_SLO_CONTRACT_VERSION } from './slo-phase52';

const sql = readFileSync(
  new URL('../../../supabase/phase52_slo_governance_ops.sql', import.meta.url),
  'utf8',
);
const repo = readFileSync(new URL('./slo-policy.ts', import.meta.url), 'utf8');
const phase52Lib = readFileSync(new URL('./slo-phase52.ts', import.meta.url), 'utf8');
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

describe('Phase 52 SLO governance ops', () => {
  it('adds firm-wide admin summary trend for digest delivery health', () => {
    expect(sql).toContain('record_slo_firm_digest_admin_summary_trend_phase52');
    expect(sql).toContain('list_slo_firm_digest_admin_summary_trend_phase52');
    expect(sql).toContain('get_slo_phase52_firm_digest_admin_report');
    expect(sql).toContain('os_slo_firm_digest_admin_summary_trend_snapshots');
    expect(sql).toContain('os_slo_owner_digest_wow_trend_snapshots');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('set search_path = public, extensions');
    expect(sql).toContain('full_push');
    expect(sql).toContain("'phase52-v1'");
    expect(sql).not.toMatch(/email\s+text/i);
    expect(sql).not.toMatch(/webhook_url\s+text/i);
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('is still pull-only / NOT a full push system', () => {
    expect(sql).toContain("'full_push',false");
    expect(sql).toContain("'chart_ready'");
    expect(sql).not.toMatch(/insert\s+into\s+public\.os_slo_handoff_digest_notifications/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.os_slo_digest_notification_deliveries/i);
  });

  it('firm-wide report and list require firm-wide access', () => {
    expect(sql).toMatch(
      /firm-wide access required for slo phase 52 firm digest admin/i,
    );
  });

  it('grants report execute to authenticated+service_role, record to service_role', () => {
    expect(sql).toMatch(
      /public\.list_slo_firm_digest_admin_summary_trend_phase52\(integer\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.get_slo_phase52_firm_digest_admin_report\(\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.record_slo_firm_digest_admin_summary_trend_phase52\(uuid\)[\s\S]*?to service_role/,
    );
  });

  it('wires processSloGovernancePhase52, admin UI, hub surface, and evaluate tick', () => {
    expect(repo).toContain('processSloGovernancePhase52');
    expect(repo).toContain('phase52Report');
    expect(phase52Lib).toContain('processSloGovernancePhase52');
    expect(phase52Lib).toContain(PHASE52_SLO_CONTRACT_VERSION);
    expect(phase52Lib).toContain('full_push');
    expect(admin).toContain('listSloFirmDigestAdminSummaryTrendAction');
    expect(admin).toContain('phase52Report');
    expect(actions).toContain('listSloFirmDigestAdminSummaryTrendAction');
    expect(evaluateRoute).toContain('processSloGovernancePhase52');
    expect(evaluateRoute.indexOf('processSloGovernancePhase51')).toBeLessThan(
      evaluateRoute.indexOf('processSloGovernancePhase52'),
    );
    expect(hubPage).toContain('SloPolicyAdmin');
  });

  it('contract version is phase52-v1', () => {
    expect(PHASE52_SLO_CONTRACT_VERSION).toBe('phase52-v1');
  });
});
