import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { webhookUrl } from './slo-delivery';

const sql = readFileSync(
  new URL('../../../supabase/phase39_slo_policy_editing_route_tests.sql', import.meta.url),
  'utf8',
);
const deliverySource = readFileSync(new URL('./slo-delivery.ts', import.meta.url), 'utf8');

afterEach(() => {
  delete process.env.SLO_WEBHOOK_OPS_ALERTS;
  delete process.env.SLO_WEBHOOK_ALLOWED_HOSTS;
});

describe('Phase 39 SLO policy governance', () => {
  it('keeps function bodies and migration dependencies structurally complete', () => {
    expect((sql.split('$$').length - 1) % 2).toBe(0);
    expect(sql).toContain('phase38_slo_ownership_delivery.sql');
    expect(sql).toMatch(/os_slo_one_draft_per_policy/);
  });

  it('requires optimistic versions and a different maker/checker', () => {
    expect(sql).toMatch(/v\.row_version<>p_expected_row_version/);
    expect(sql).toMatch(/if v\.created_by=p_actor_id[\s\S]*Maker-checker/);
    expect(sql).toMatch(/lifecycle_status='validated'/);
    expect(sql).toMatch(/os_slo_policy_audit_append_only/);
    expect(sql).toMatch(/os_slo_policy_audit_no_truncate/);
    expect(sql).toMatch(/'state','validated','replayed',true/);
    expect(sql).toMatch(/'state','published','replayed',true/);
    expect(sql).toMatch(/os_slo_policy_state_check/);
    expect(sql).not.toMatch(/p_interval>p_window|p_window%p_interval/);
    expect(sql).toMatch(/Retired by Phase 39 owner-role enforcement/);
    expect(sql).toMatch(
      /create or replace function public\.reassign_slo_alert[\s\S]*phase39_owner_authorized/,
    );
  });

  it('rejects URL-shaped destinations and only grants mutations to service role', () => {
    expect(sql).toMatch(/never URLs/);
    expect(sql).not.toContain("v_value~* '://|^https?|'");
    expect(sql).toMatch(/p_destination_key~\* ':\/\/\|\^https\?'/);
    expect(sql).toMatch(
      /grant execute on function public\.save_slo_policy_draft_phase39[\s\S]*to service_role/,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.save_slo_policy_draft_phase39[\s\S]*to authenticated/,
    );
    expect(sql).toMatch(
      /revoke insert,update,delete,truncate on[\s\S]*from public,authenticated,service_role/,
    );
    expect(sql).toMatch(
      /revoke execute on function public\.publish_slo_policy[\s\S]*from public,authenticated,service_role/,
    );
  });
});

describe('Phase 39 route test isolation', () => {
  it('marks route-test records and payloads as tests without alert mutations', () => {
    const routeSection = sql.slice(sql.indexOf('create table if not exists public.os_slo_route_tests'));
    expect(routeSection).toMatch(/is_test boolean not null default true check \(is_test\)/);
    expect(routeSection).toMatch(/'test',true/);
    expect(routeSection).not.toMatch(/insert into public\.os_slo_alerts/);
    expect(routeSection).not.toMatch(/update public\.os_slo_alerts/);
    expect(routeSection).toMatch(/for update skip locked/);
    expect(routeSection).toMatch(/idempotency_key text not null unique/);
    expect(routeSection).toMatch(/phase39_redact\(p_error_detail\)/);
    expect(routeSection).toMatch(/os_slo_route_test_attempts_no_truncate/);
    expect(routeSection).toMatch(/'slo_route_test'/);
    expect(routeSection).toMatch(/t\.adapter=v\.adapter/);
  });

  it('resolves webhook keys only from HTTPS environment destinations', () => {
    process.env.SLO_WEBHOOK_ALLOWED_HOSTS = 'hooks.example.test';
    process.env.SLO_WEBHOOK_OPS_ALERTS = 'https://hooks.example.test/slo';
    expect(webhookUrl('ops_alerts')).toBe('https://hooks.example.test/slo');
    process.env.SLO_WEBHOOK_OPS_ALERTS = 'http://hooks.example.test/slo';
    expect(webhookUrl('ops_alerts')).toBeNull();
    expect(webhookUrl('https://attacker.example')).toBeNull();
  });

  it('fails closed for unapproved, credentialed, IP, and redirect delivery', () => {
    process.env.SLO_WEBHOOK_OPS_ALERTS = 'https://hooks.example.test/slo';
    expect(webhookUrl('ops_alerts')).toBeNull();
    process.env.SLO_WEBHOOK_ALLOWED_HOSTS = 'hooks.example.test';
    process.env.SLO_WEBHOOK_OPS_ALERTS =
      'https://user:secret@hooks.example.test/slo';
    expect(webhookUrl('ops_alerts')).toBeNull();
    process.env.SLO_WEBHOOK_ALLOWED_HOSTS = '127.0.0.1';
    process.env.SLO_WEBHOOK_OPS_ALERTS = 'https://127.0.0.1/slo';
    expect(webhookUrl('ops_alerts')).toBeNull();
    expect(deliverySource).toMatch(/redirect: 'error'/);
    expect(deliverySource.indexOf('claim_slo_route_test_jobs_phase39')).toBeGreaterThan(
      deliverySource.indexOf('for (const job of jobs)'),
    );
    expect(deliverySource).toContain('claimed: jobs.length,');
    expect(deliverySource).toContain('routeTestsDelivered');
  });
});
