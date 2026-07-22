import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  REVENUE_PHASE45_ALERT_KINDS,
  REVENUE_REPORT_VERSION_PHASE45,
} from './marketing-revenue-contracts';
import { emptyPhase45RevenueOpsReport } from './marketing-phase45';

describe('Phase 45 marketing revenue ops', () => {
  it('shapes the phase45 ops report contract and empty helper', () => {
    const empty = emptyPhase45RevenueOpsReport();
    expect(empty.version).toBe(REVENUE_REPORT_VERSION_PHASE45);
    expect(empty.webhook_delivery_health).toBe('unknown');
    expect(empty.workflow_health).toBe('unknown');
    expect(empty.alert_delivery).toBe('none');
    expect(empty.active_rule).toBeNull();
    expect(empty.webhook_snapshots).toEqual([]);
    expect(empty.workflow_snapshots).toEqual([]);
    expect(empty.rule_versions).toEqual([]);
    expect(empty.alerts).toEqual([]);
    expect(empty.destination_key).toBe('ops_alerts');
    expect(REVENUE_PHASE45_ALERT_KINDS).toEqual([
      'webhook_delivery_critical',
      'auto_reject_rule_tuned',
      'correction_workflow_stale',
      'validation_fail_rate_elevated',
    ]);
  });

  it('enforces phase45 SQL tables, maker-checker rules, and grants', () => {
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase45_marketing_revenue_ops.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sql).toMatch(/Phase 45/);
    expect(sql).toMatch(/phase44_marketing_revenue_ops\.sql/);
    expect(sql).toMatch(/public\.os_sha256_hex/);
    expect(sql).toMatch(/search_path = public, extensions/);
    expect(sql).toMatch(/os_marketing_revenue_auto_reject_rule_versions/);
    expect(sql).toMatch(/os_marketing_revenue_webhook_delivery_slo_snapshots/);
    expect(sql).toMatch(/os_marketing_revenue_correction_workflow_snapshots/);
    expect(sql).toMatch(/os_marketing_revenue_phase45_ops_alerts/);
    expect(sql).toMatch(/Marketing revenue Phase 45 ops evidence is append-only/);
    expect(sql).toMatch(/phase45_marketing_ops_safe_metadata/);
    expect(sql).toMatch(/propose_marketing_auto_reject_rule_phase45/);
    expect(sql).toMatch(/activate_marketing_auto_reject_rule_phase45/);
    expect(sql).toMatch(/record_marketing_revenue_webhook_delivery_slo_phase45/);
    expect(sql).toMatch(
      /record_marketing_revenue_correction_workflow_snapshot_phase45/,
    );
    expect(sql).toMatch(/list_marketing_revenue_phase45_critical_windows/);
    expect(sql).toMatch(/record_marketing_revenue_phase45_ops_alert/);
    expect(sql).toMatch(/get_marketing_revenue_phase45_ops_report/);
    expect(sql).toMatch(/phase45-v1/);
    expect(sql).toMatch(/NEVER auto-approves/);
    expect(sql).toMatch(/Maker-checker requires a different actor/);
    expect(sql).toMatch(/phase45_active_auto_reject_thresholds/);
    expect(sql).toMatch(/validate_marketing_revenue_corrections_phase44/);
    expect(sql).toMatch(/auto_reject_on_contract_fail/);
    expect(sql).toMatch(/os_marketing_revenue_phase43_ops_alerts/);
    expect(sql).toMatch(/os_marketing_revenue_phase44_ops_alerts/);
    expect(sql).toMatch(/webhook_delivery_critical/);
    expect(sql).toMatch(/correction_workflow_stale/);
    expect(sql).toMatch(/validation_fail_rate_elevated/);
    expect(sql).toMatch(/window_key text not null unique/);
    expect(sql).toMatch(
      /grant execute on function public\.get_marketing_revenue_phase45_ops_report\(text,integer\)\s+to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.propose_marketing_auto_reject_rule_phase45\(jsonb\)\s+to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.activate_marketing_auto_reject_rule_phase45\(jsonb\)\s+to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_marketing_revenue_phase45_ops_alert\(jsonb\)\s+to service_role/,
    );
    expect(sql).not.toMatch(/os_store_snapshots/);
    expect(sql).not.toMatch(/if\s+case\s+when/i);
    expect(sql).not.toMatch(/p_decision\s*=\s*'approved'/);
  });

  it('wires phase45 ops tick after phase44 and hub badges', () => {
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
      new URL('./marketing-phase45.ts', import.meta.url),
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
    expect(page).toMatch(/getPhase45RevenueOpsReport/);
    expect(page).toMatch(/Phase 4[56]/);
    expect(page).toMatch(/phase45OpsReport=\{phase45OpsReport\.report\}/);
    expect(ui).toMatch(/webhook delivery/);
    expect(ui).toMatch(/workflow health/);
    expect(ui).toMatch(/auto-reject/);
    expect(worker).toMatch(/runPhase45RevenueOpsTick/);
    expect(worker).toMatch(/runPhase44RevenueOpsTick/);
    expect(worker.lastIndexOf('runPhase45RevenueOpsTick')).toBeGreaterThan(
      worker.lastIndexOf('runPhase44RevenueOpsTick'),
    );
    expect(lib).toMatch(/webhookUrl/);
    expect(lib).toMatch(/ops_alerts/);
    expect(lib).toMatch(/record_marketing_revenue_webhook_delivery_slo_phase45/);
    expect(lib).toMatch(
      /record_marketing_revenue_correction_workflow_snapshot_phase45/,
    );
    expect(lib).toMatch(/list_marketing_revenue_phase45_critical_windows/);
    expect(lib).toMatch(/record_marketing_revenue_phase45_ops_alert/);
    expect(route).toMatch(/phase4[56]-v1/);
    expect(route).toMatch(/webhook_delivery_slos/);
    expect(route).toMatch(/correction_workflow_monitoring/);
  });

  it('never logs or stores secret values in phase45 surfaces', () => {
    const lib = readFileSync(
      new URL('./marketing-phase45.ts', import.meta.url),
      'utf8',
    );
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase45_marketing_revenue_ops.sql',
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
