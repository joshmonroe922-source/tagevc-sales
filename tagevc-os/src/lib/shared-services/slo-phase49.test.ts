import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PHASE49_SLO_CONTRACT_VERSION } from './slo-phase49';

const sql = readFileSync(
  new URL('../../../supabase/phase49_slo_governance_ops.sql', import.meta.url),
  'utf8',
);
const repo = readFileSync(new URL('./slo-policy.ts', import.meta.url), 'utf8');
const phase49Lib = readFileSync(new URL('./slo-phase49.ts', import.meta.url), 'utf8');
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

describe('Phase 49 SLO governance ops', () => {
  it('adds per-owner digest delivery success SLO tracking without full push', () => {
    expect(sql).toContain('os_slo_owner_digest_delivery_success_slos');
    expect(sql).toContain('scan_slo_owner_digest_delivery_success_phase49');
    expect(sql).toContain('get_slo_phase49_owner_digest_report');
    expect(sql).toContain('phase49_slo_safe_detail');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain("set search_path = public, extensions");
    expect(sql).toContain('full_push');
    expect(sql).toContain('production_alerts_mutated');
    expect(sql).toContain("'phase49-v1'");
    expect(sql).not.toMatch(/email\s+text/i);
    expect(sql).not.toMatch(/webhook_url\s+text/i);
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('is read+append-only: scans from Phase 48 delivery evidence, never mutates it', () => {
    expect(sql).toMatch(
      /from public\.os_slo_digest_notification_deliveries d\s*\n\s*join public\.os_slo_handoff_digest_notifications n/,
    );
    expect(sql).not.toMatch(
      /update\s+public\.os_slo_digest_notification_deliveries/i,
    );
    expect(sql).not.toMatch(
      /delete\s+from\s+public\.os_slo_digest_notification_deliveries/i,
    );
    expect(sql).toMatch(/append-only/);
    expect(sql).toContain('prevent_slo_phase49_append_only');
  });

  it('enables RLS and keeps mutation RPC service-role-only, report authenticated', () => {
    expect(sql).toContain(
      'alter table public.os_slo_owner_digest_delivery_success_slos enable row level security',
    );
    expect(sql).toMatch(
      /revoke all on function public\.scan_slo_owner_digest_delivery_success_phase49[\s\S]*?from public,authenticated/,
    );
    expect(sql).toMatch(
      /public\.scan_slo_owner_digest_delivery_success_phase49\(\s*uuid,integer\s*\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.get_slo_phase49_owner_digest_report\(\)[\s\S]*?to authenticated, service_role/,
    );
  });

  it('wires processSloGovernancePhase49, admin UI, hub surface, and evaluate tick', () => {
    expect(repo).toContain('processSloGovernancePhase49');
    expect(repo).toContain('ownerDigestSuccessSlos');
    expect(repo).toContain('phase49Report');
    expect(phase49Lib).toContain('processSloGovernancePhase49');
    expect(phase49Lib).toContain(PHASE49_SLO_CONTRACT_VERSION);
    expect(phase49Lib).toContain('full_push');
    expect(admin).toContain('scanSloOwnerDigestDeliverySuccessAction');
    expect(admin).toContain('Scan owner digest success SLO');
    expect(admin).toContain('phase49Report');
    expect(admin).toContain('ownerDigestSuccessSlos');
    expect(actions).toContain('scanSloOwnerDigestDeliverySuccessAction');
    expect(evaluateRoute).toContain('processSloGovernancePhase49');
    expect(evaluateRoute.indexOf('processSloGovernancePhase48')).toBeLessThan(
      evaluateRoute.indexOf('processSloGovernancePhase49'),
    );
    expect(hubPage).toContain('SloPolicyAdmin');
    expect(hubPage).toContain('policyAdministration');
  });

  it('contract version is phase49-v1 for scan and report shapes', () => {
    expect(PHASE49_SLO_CONTRACT_VERSION).toBe('phase49-v1');
  });
});
