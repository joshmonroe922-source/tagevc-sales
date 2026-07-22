import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PHASE50_SLO_CONTRACT_VERSION } from './slo-phase50';

const sql = readFileSync(
  new URL('../../../supabase/phase50_slo_governance_ops.sql', import.meta.url),
  'utf8',
);
const repo = readFileSync(new URL('./slo-policy.ts', import.meta.url), 'utf8');
const phase50Lib = readFileSync(new URL('./slo-phase50.ts', import.meta.url), 'utf8');
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

describe('Phase 50 SLO governance ops', () => {
  it('adds week-over-week owner digest trend tracking and self-serve opt-in without full push', () => {
    expect(sql).toContain('os_slo_owner_digest_wow_trend_snapshots');
    expect(sql).toContain('os_slo_owner_digest_self_serve_opt_ins');
    expect(sql).toContain('record_slo_owner_digest_wow_trend_phase50');
    expect(sql).toContain('set_slo_owner_digest_self_serve_opt_in_phase50');
    expect(sql).toContain('list_slo_owner_digest_self_serve_failures_phase50');
    expect(sql).toContain('get_slo_phase50_owner_digest_report');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('set search_path = public, extensions');
    expect(sql).toContain('full_push');
    expect(sql).toContain('production_alerts_mutated');
    expect(sql).toContain("'phase50-v1'");
    expect(sql).not.toMatch(/email\s+text/i);
    expect(sql).not.toMatch(/webhook_url\s+text/i);
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('is read+append-only: computes trends from Phase 49 evidence, never mutates it', () => {
    expect(sql).toMatch(
      /from public\.os_slo_owner_digest_delivery_success_slos cur/,
    );
    expect(sql).not.toMatch(
      /update\s+public\.os_slo_owner_digest_delivery_success_slos/i,
    );
    expect(sql).not.toMatch(
      /delete\s+from\s+public\.os_slo_owner_digest_delivery_success_slos/i,
    );
    expect(sql).toMatch(/append-only/);
    expect(sql).toContain('prevent_slo_phase50_append_only');
  });

  it('self-serve failure view only returns rows when the owner is opted in, and is pull-only (not full push)', () => {
    expect(sql).toMatch(/if v_opted_in then/);
    expect(sql).toMatch(/'failures',v_failures/);
    expect(sql).toContain("'full_push',false");
    expect(sql).not.toMatch(/insert\s+into\s+public\.os_slo_handoff_digest_notifications/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.os_slo_digest_notification_deliveries/i);
  });

  it('enables RLS and keeps mutation RPCs service-role/authenticated-appropriate, report authenticated', () => {
    expect(sql).toContain(
      'alter table public.os_slo_owner_digest_wow_trend_snapshots enable row level security',
    );
    expect(sql).toContain(
      'alter table public.os_slo_owner_digest_self_serve_opt_ins enable row level security',
    );
    expect(sql).toMatch(
      /revoke all on function public\.record_slo_owner_digest_wow_trend_phase50\(uuid\)[\s\S]*?from public,authenticated/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_slo_owner_digest_wow_trend_phase50\(uuid\)\s*\n\s*to service_role/,
    );
    expect(sql).toMatch(
      /public\.set_slo_owner_digest_self_serve_opt_in_phase50\([\s\S]*?\)\s*\n\s*to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.get_slo_phase50_owner_digest_report\(\)[\s\S]*?to authenticated, service_role/,
    );
  });

  it('only the owner or a firm-wide actor may change or view the self-serve opt-in', () => {
    expect(sql).toMatch(
      /only the owner or a firm-wide actor may change this opt-in/i,
    );
    expect(sql).toMatch(
      /only the owner or a firm-wide actor may view these failures/i,
    );
  });

  it('wires processSloGovernancePhase50, admin UI, hub surface, and evaluate tick', () => {
    expect(repo).toContain('processSloGovernancePhase50');
    expect(repo).toContain('ownerDigestWowTrendSnapshots');
    expect(repo).toContain('ownerDigestSelfServeOptIns');
    expect(repo).toContain('phase50Report');
    expect(phase50Lib).toContain('processSloGovernancePhase50');
    expect(phase50Lib).toContain(PHASE50_SLO_CONTRACT_VERSION);
    expect(phase50Lib).toContain('full_push');
    expect(admin).toContain('recordSloOwnerDigestWowTrendAction');
    expect(admin).toContain('setSloOwnerDigestSelfServeOptInAction');
    expect(admin).toContain('listSloOwnerDigestSelfServeFailuresAction');
    expect(admin).toContain('phase50Report');
    expect(admin).toContain('ownerDigestWowTrendSnapshots');
    expect(actions).toContain('recordSloOwnerDigestWowTrendAction');
    expect(actions).toContain('setSloOwnerDigestSelfServeOptInAction');
    expect(actions).toContain('listSloOwnerDigestSelfServeFailuresAction');
    expect(evaluateRoute).toContain('processSloGovernancePhase50');
    expect(evaluateRoute.indexOf('processSloGovernancePhase49')).toBeLessThan(
      evaluateRoute.indexOf('processSloGovernancePhase50'),
    );
    expect(hubPage).toContain('SloPolicyAdmin');
    expect(hubPage).toContain('policyAdministration');
  });

  it('contract version is phase50-v1 for trend, opt-in, and report shapes', () => {
    expect(PHASE50_SLO_CONTRACT_VERSION).toBe('phase50-v1');
  });
});
