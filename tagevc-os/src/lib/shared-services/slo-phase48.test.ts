import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseOwnerDigestWebhooks,
  PHASE48_SLO_CONTRACT_VERSION,
} from './slo-phase48';
import { sloSimulationExportRetentionDays } from './slo-policy';

const sql = readFileSync(
  new URL('../../../supabase/phase48_slo_governance_ops.sql', import.meta.url),
  'utf8',
);
const repo = readFileSync(new URL('./slo-policy.ts', import.meta.url), 'utf8');
const phase48Lib = readFileSync(new URL('./slo-phase48.ts', import.meta.url), 'utf8');
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
const envExample = readFileSync(
  new URL('../../../.env.example', import.meta.url),
  'utf8',
);

const ORIGINAL_ENV = { ...process.env };

describe('Phase 48 SLO governance ops', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('adds allowlisted owner digest webhooks and delivery SLO tracking without full push', () => {
    expect(sql).toContain('os_slo_owner_digest_webhook_allowlist');
    expect(sql).toContain('register_slo_owner_digest_webhook_allowlist_phase48');
    expect(sql).toContain('host_sha256');
    expect(sql).toContain('os_slo_digest_notification_deliveries');
    expect(sql).toContain('record_slo_digest_notification_delivery_phase48');
    expect(sql).toContain('os_slo_digest_notification_delivery_slo');
    expect(sql).toContain('scan_slo_digest_notification_delivery_slo_phase48');
    expect(sql).toContain('os_slo_digest_notification_delivery_visibility');
    expect(sql).toContain('delivery_slo_critical');
    expect(sql).toContain('get_slo_phase48_governance_report');
    expect(sql).toContain('full_push');
    expect(sql).toContain('production_alerts_mutated');
    expect(sql).toContain('phase48_slo_safe_detail');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).not.toMatch(/email\s+text/i);
    expect(sql).not.toMatch(/webhook_url\s+text/i);
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('keeps mutation RPCs service-role-only and grants report to authenticated', () => {
    expect(sql).toMatch(
      /revoke all on function public\.register_slo_owner_digest_webhook_allowlist_phase48[\s\S]*?from public,authenticated/,
    );
    expect(sql).toMatch(
      /revoke all on function public\.record_slo_digest_notification_delivery_phase48[\s\S]*?from public,authenticated/,
    );
    expect(sql).toMatch(
      /revoke all on function public\.scan_slo_digest_notification_delivery_slo_phase48[\s\S]*?from public,authenticated/,
    );
    expect(sql).toMatch(
      /public\.register_slo_owner_digest_webhook_allowlist_phase48\([\s\S]*?\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.scan_slo_digest_notification_delivery_slo_phase48\(uuid,integer\)[\s\S]*?to service_role/,
    );
    expect(sql).toMatch(
      /public\.get_slo_phase48_governance_report\(\)[\s\S]*?to authenticated, service_role/,
    );
  });

  it('wires processSloGovernancePhase48, admin UI, and evaluate tick', () => {
    expect(repo).toContain('processSloGovernancePhase48');
    expect(phase48Lib).toContain('processSloGovernancePhase48');
    expect(phase48Lib).toContain('SLO_OWNER_DIGEST_WEBHOOKS');
    expect(phase48Lib).toContain(PHASE48_SLO_CONTRACT_VERSION);
    expect(phase48Lib).toContain('full_push');
    expect(admin).toContain('deliverSloOwnerDigestWebhooksAction');
    expect(admin).toContain('Deliver owner digest webhooks');
    expect(admin).toContain('scanSloDigestNotificationDeliverySloAction');
    expect(admin).toContain('Scan digest delivery SLO');
    expect(admin).toContain('phase48Report');
    expect(actions).toContain('deliverSloOwnerDigestWebhooksAction');
    expect(actions).toContain('scanSloDigestNotificationDeliverySloAction');
    expect(evaluateRoute).toContain('processSloGovernancePhase48');
    expect(evaluateRoute.indexOf('processSloGovernancePhase47')).toBeLessThan(
      evaluateRoute.indexOf('processSloGovernancePhase48'),
    );
    expect(envExample).toContain('SLO_OWNER_DIGEST_WEBHOOKS');
  });

  it('parses allowlisted owner digest webhooks and rejects non-allowlisted hosts', () => {
    delete process.env.SLO_OWNER_DIGEST_WEBHOOKS;
    delete process.env.SLO_WEBHOOK_ALLOWED_HOSTS;
    expect(parseOwnerDigestWebhooks()).toEqual([]);

    process.env.SLO_WEBHOOK_ALLOWED_HOSTS = 'hooks.example.com';
    process.env.SLO_OWNER_DIGEST_WEBHOOKS = JSON.stringify({
      owner_digest: 'https://hooks.example.com/digest',
      bad: 'https://evil.example.net/x',
      also_bad: 'http://hooks.example.com/digest',
    });
    const parsed = parseOwnerDigestWebhooks();
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.destination_key).toBe('owner_digest');
    expect(parsed[0]?.url).toBe('https://hooks.example.com/digest');
    expect(parsed[0]?.host_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reuses retention env bounds from Phase 42', () => {
    delete process.env.SLO_SIMULATION_EXPORT_RETENTION_DAYS;
    expect(sloSimulationExportRetentionDays()).toBe(90);
  });
});
