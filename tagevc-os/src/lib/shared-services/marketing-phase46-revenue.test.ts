import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  REVENUE_PHASE46_ALERT_KINDS,
  REVENUE_REPORT_VERSION_PHASE46,
} from './marketing-revenue-contracts';
import { emptyPhase46RevenueOpsReport } from './marketing-phase46';

describe('Phase 46 marketing revenue ops', () => {
  it('shapes the phase46 ops report contract and empty helper', () => {
    const empty = emptyPhase46RevenueOpsReport();
    expect(empty.version).toBe(REVENUE_REPORT_VERSION_PHASE46);
    expect(empty.promotion_gate_health).toBe('unknown');
    expect(empty.webhook_reliability_health).toBe('unknown');
    expect(empty.rule_performance_health).toBe('unknown');
    expect(empty.alert_delivery).toBe('none');
    expect(empty.promotion_gate).toBeNull();
    expect(empty.promotions).toEqual([]);
    expect(empty.performance_snapshots).toEqual([]);
    expect(empty.reliability_snapshots).toEqual([]);
    expect(empty.alerts).toEqual([]);
    expect(empty.destination_key).toBe('ops_alerts');
    expect(REVENUE_PHASE46_ALERT_KINDS).toEqual([
      'auto_reject_promotion_blocked',
      'auto_reject_promoted',
      'webhook_reliability_degraded',
      'rule_performance_anomaly',
    ]);
  });

  it('enforces phase46 SQL tables, promotion gates, and grants', () => {
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase46_marketing_revenue_ops.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sql).toMatch(/Phase 46/);
    expect(sql).toMatch(/phase45_marketing_revenue_ops\.sql/);
    expect(sql).toMatch(/public\.os_sha256_hex/);
    expect(sql).toMatch(/search_path = public, extensions/);
    expect(sql).toMatch(/os_marketing_revenue_auto_reject_promotions/);
    expect(sql).toMatch(
      /os_marketing_revenue_auto_reject_performance_snapshots/,
    );
    expect(sql).toMatch(/os_marketing_revenue_webhook_reliability_snapshots/);
    expect(sql).toMatch(/os_marketing_revenue_phase46_ops_alerts/);
    expect(sql).toMatch(/Marketing revenue Phase 46 ops evidence is append-only/);
    expect(sql).toMatch(/phase46_marketing_ops_safe_metadata/);
    expect(sql).toMatch(/evaluate_marketing_auto_reject_promotion_gate_phase46/);
    expect(sql).toMatch(/promote_marketing_auto_reject_rule_phase46/);
    expect(sql).toMatch(
      /record_marketing_auto_reject_performance_snapshot_phase46/,
    );
    expect(sql).toMatch(
      /record_marketing_webhook_reliability_snapshot_phase46/,
    );
    expect(sql).toMatch(/list_marketing_revenue_phase46_critical_windows/);
    expect(sql).toMatch(/record_marketing_revenue_phase46_ops_alert/);
    expect(sql).toMatch(/get_marketing_revenue_phase46_ops_report/);
    expect(sql).toMatch(/phase46-v1/);
    expect(sql).toMatch(/NEVER auto-approves/);
    expect(sql).toMatch(/activate_marketing_auto_reject_rule_phase45/);
    expect(sql).toMatch(/os_marketing_revenue_webhook_delivery_slo_snapshots/);
    expect(sql).toMatch(/webhook_slo_windows_required/);
    expect(sql).toMatch(/webhook_slo_windows_healthy/);
    expect(sql).toMatch(/'blocked','promoted','rejected'/);
    expect(sql).toMatch(/precision_rate/);
    expect(sql).toMatch(/consecutive_healthy_windows/);
    expect(sql).toMatch(/auto_reject_promotion_blocked/);
    expect(sql).toMatch(/auto_reject_promoted/);
    expect(sql).toMatch(/webhook_reliability_degraded/);
    expect(sql).toMatch(/rule_performance_anomaly/);
    expect(sql).toMatch(/window_key text not null unique/);
    expect(sql).toMatch(
      /grant execute on function public\.get_marketing_revenue_phase46_ops_report\(text,integer\)\s+to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.evaluate_marketing_auto_reject_promotion_gate_phase46\(jsonb\)\s+to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.promote_marketing_auto_reject_rule_phase46\(jsonb\)\s+to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_marketing_revenue_phase46_ops_alert\(jsonb\)\s+to service_role/,
    );
    expect(sql).not.toMatch(/os_store_snapshots/);
    expect(sql).not.toMatch(/if\s+case\s+when/i);
    expect(sql).not.toMatch(/p_decision\s*=\s*'approved'/);
  });

  it('wires phase46 ops tick after phase45 and hub badges', () => {
    const page = readFileSync(
      new URL(
        '../../app/(app)/shared-services/marketing/page.tsx',
        import.meta.url,
      ),
      'utf8',
    );
    const worker = readFileSync(
      new URL('./marketing-revenue-worker.ts', import.meta.url),
      'utf8',
    );
    const lib = readFileSync(
      new URL('./marketing-phase46.ts', import.meta.url),
      'utf8',
    );
    const route = readFileSync(
      new URL(
        '../../app/api/marketing/revenue-ingestion-worker/route.ts',
        import.meta.url,
      ),
      'utf8',
    );
    const ui = readFileSync(
      new URL(
        '../../components/shared-services/marketing-revenue-phase41.tsx',
        import.meta.url,
      ),
      'utf8',
    );
    expect(page).toMatch(/getPhase46RevenueOpsReport/);
    expect(page).toMatch(/Phase 4[678]/);
    expect(page).toMatch(/phase46OpsReport=\{phase46OpsReport\.report\}/);
    expect(ui).toMatch(/promotion gate/);
    expect(ui).toMatch(/webhook reliability/);
    expect(ui).toMatch(/rule performance/);
    expect(worker).toMatch(/runPhase46RevenueOpsTick/);
    expect(worker).toMatch(/runPhase45RevenueOpsTick/);
    expect(worker.lastIndexOf('runPhase46RevenueOpsTick')).toBeGreaterThan(
      worker.lastIndexOf('runPhase45RevenueOpsTick'),
    );
    expect(lib).toMatch(/webhookUrl/);
    expect(lib).toMatch(/ops_alerts/);
    expect(lib).toMatch(
      /record_marketing_auto_reject_performance_snapshot_phase46/,
    );
    expect(lib).toMatch(
      /record_marketing_webhook_reliability_snapshot_phase46/,
    );
    expect(lib).toMatch(/list_marketing_revenue_phase46_critical_windows/);
    expect(lib).toMatch(/record_marketing_revenue_phase46_ops_alert/);
    expect(route).toMatch(/phase4[678]-v1/);
    expect(route).toMatch(/auto_reject_promotion_gates/);
    expect(route).toMatch(/webhook_reliability_trends/);
    expect(route).toMatch(/rule_performance_snapshots/);
  });

  it('never logs or stores secret values in phase46 surfaces', () => {
    const lib = readFileSync(
      new URL('./marketing-phase46.ts', import.meta.url),
      'utf8',
    );
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase46_marketing_revenue_ops.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(lib).not.toMatch(/credential_env_value/);
    expect(lib).not.toMatch(/signature_env_value/);
    expect(lib).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY\]/);
    expect(sql).toMatch(/Never stores secret values/);
    expect(sql).toMatch(/'value','env_value'/);
    expect(sql).not.toMatch(/os_store_snapshots/);
  });
});
