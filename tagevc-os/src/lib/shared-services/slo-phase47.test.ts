import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { sloSimulationExportRetentionDays } from './slo-policy';

const sql = readFileSync(
  new URL('../../../supabase/phase47_slo_governance_ops.sql', import.meta.url),
  'utf8',
);
const repo = readFileSync(new URL('./slo-policy.ts', import.meta.url), 'utf8');
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

const ORIGINAL_ENV = { ...process.env };

describe('Phase 47 SLO governance ops', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('adds digest owner notify and ownership-change visibility without PII', () => {
    expect(sql).toContain('os_slo_handoff_digest_notifications');
    expect(sql).toContain('notify_slo_handoff_digest_owners_phase47');
    expect(sql).toContain('destination_key');
    expect(sql).toContain('owner_id');
    expect(sql).toContain('delivery_status');
    expect(sql).toContain('os_slo_ownership_change_visibility');
    expect(sql).toContain('upcoming_handoff_window');
    expect(sql).toContain('handoff_window_start');
    expect(sql).toContain('handoff_window_end');
    expect(sql).toContain('scan_slo_ownership_change_visibility_phase47');
    expect(sql).toContain('get_slo_phase47_governance_report');
    expect(sql).toContain('production_alerts_mutated');
    expect(sql).toContain('full_push');
    expect(sql).toContain('phase47_slo_safe_detail');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).not.toMatch(/email\s+text/i);
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('keeps mutation RPCs service-role-only and grants report to authenticated', () => {
    expect(sql).toMatch(
      /revoke all on function public\.notify_slo_handoff_digest_owners_phase47[\s\S]*?from public,authenticated/,
    );
    expect(sql).toMatch(
      /revoke all on function public\.scan_slo_ownership_change_visibility_phase47[\s\S]*?from public,authenticated/,
    );
    expect(sql).toMatch(
      /public\.notify_slo_handoff_digest_owners_phase47\(uuid,uuid,text\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.scan_slo_ownership_change_visibility_phase47\(uuid,integer\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.get_slo_phase47_governance_report\(\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.notify_slo_handoff_digest_owners_phase47\([^)]*\)\s*to authenticated/,
    );
  });

  it('wires notify, visibility, and evaluate tick into app surfaces', () => {
    expect(repo).toContain("'notify_slo_handoff_digest_owners_phase47'");
    expect(repo).toContain("'scan_slo_ownership_change_visibility_phase47'");
    expect(repo).toContain('processSloGovernancePhase47');
    expect(repo).toContain('notifySloHandoffDigestOwnersPhase47');
    expect(repo).toContain('scanSloOwnershipChangeVisibilityPhase47');
    expect(admin).toContain('notifySloHandoffDigestOwnersAction');
    expect(admin).toContain('Notify digest owners');
    expect(admin).toContain('scanSloOwnershipChangeVisibilityAction');
    expect(admin).toContain('Scan ownership visibility');
    expect(admin).toContain('phase47Report');
    expect(actions).toContain('notifySloHandoffDigestOwnersAction');
    expect(actions).toContain('scanSloOwnershipChangeVisibilityAction');
    expect(evaluateRoute).toContain('processSloGovernancePhase47');
    expect(evaluateRoute.indexOf('processSloGovernancePhase46')).toBeLessThan(
      evaluateRoute.indexOf('processSloGovernancePhase47'),
    );
  });

  it('reuses retention env bounds from Phase 42', () => {
    delete process.env.SLO_SIMULATION_EXPORT_RETENTION_DAYS;
    expect(sloSimulationExportRetentionDays()).toBe(90);
    process.env.SLO_SIMULATION_EXPORT_RETENTION_DAYS = '120';
    expect(sloSimulationExportRetentionDays()).toBe(120);
  });
});
