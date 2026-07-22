import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  REVENUE_PHASE49_ALERT_KINDS,
  REVENUE_REPORT_VERSION_PHASE49,
} from './marketing-revenue-contracts';
import { emptyPhase49RevenueOpsReport } from './marketing-phase49';

describe('Phase 49 marketing revenue ops', () => {
  it('shapes the phase49 ops report contract and empty helper', () => {
    const empty = emptyPhase49RevenueOpsReport();
    expect(empty.version).toBe(REVENUE_REPORT_VERSION_PHASE49);
    expect(empty.dry_run_health).toBe('unknown');
    expect(empty.audit_export_health).toBe('unknown');
    expect(empty.alert_delivery).toBe('none');
    expect(empty.would_promote_count).toBe(0);
    expect(empty.would_block_count).toBe(0);
    expect(empty.would_wait_count).toBe(0);
    expect(empty.audit_exports_count).toBe(0);
    expect(empty.dry_run_snapshots).toEqual([]);
    expect(empty.audit_exports).toEqual([]);
    expect(empty.alerts).toEqual([]);
    expect(empty.destination_key).toBe('ops_alerts');
    expect(empty.never_auto_approves_money).toBe(true);
    expect(REVENUE_PHASE49_ALERT_KINDS).toEqual([
      'autopilot_dry_run_would_promote',
      'autopilot_dry_run_would_block',
      'cohort_promotion_audit_exported',
    ]);
  });

  it('enforces phase49 SQL tables, dry-run, audit exports, and grants', () => {
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase49_marketing_revenue_ops.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sql).toMatch(/Phase 49/);
    expect(sql).toMatch(/phase48_marketing_revenue_ops\.sql/);
    expect(sql).toMatch(/public\.os_sha256_hex/);
    expect(sql).toMatch(/search_path = public, extensions/);
    expect(sql).toMatch(/os_marketing_revenue_autopilot_dry_run_snapshots/);
    expect(sql).toMatch(/os_marketing_revenue_cohort_promotion_audit_exports/);
    expect(sql).toMatch(/os_marketing_revenue_phase49_ops_alerts/);
    expect(sql).toMatch(/Marketing revenue Phase 49 ops evidence is append-only/);
    expect(sql).toMatch(/phase49_marketing_ops_safe_metadata/);
    expect(sql).toMatch(/record_marketing_autopilot_dry_run_snapshot_phase49/);
    expect(sql).toMatch(/export_marketing_cohort_promotion_audit_phase49/);
    expect(sql).toMatch(/list_marketing_revenue_phase49_critical_windows/);
    expect(sql).toMatch(/record_marketing_revenue_phase49_ops_alert/);
    expect(sql).toMatch(/get_marketing_revenue_phase49_ops_report/);
    expect(sql).toMatch(/phase49-v1/);
    expect(sql).toMatch(/NEVER auto-approves/);
    expect(sql).toMatch(/never_auto_approves_money/);
    expect(sql).toMatch(/never_calls_promote/);
    expect(sql).toMatch(/evaluate_marketing_cohort_promotion_gate_phase47/);
    expect(sql).not.toMatch(/promote_marketing_auto_reject_cohort_phase47/);
    expect(sql).toMatch(/autopilot_dry_run_would_promote/);
    expect(sql).toMatch(/autopilot_dry_run_would_block/);
    expect(sql).toMatch(/cohort_promotion_audit_exported/);
    expect(sql).toMatch(/'would_promote','would_block','would_wait'/);
    expect(sql).toMatch(/window_key text not null unique/);
    expect(sql).toMatch(
      /grant execute on function public\.get_marketing_revenue_phase49_ops_report\(text,integer\)\s+to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_marketing_autopilot_dry_run_snapshot_phase49\(jsonb\)\s+to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.export_marketing_cohort_promotion_audit_phase49\(jsonb\)\s+to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_marketing_revenue_phase49_ops_alert\(jsonb\)\s+to service_role/,
    );
    expect(sql).not.toMatch(/os_store_snapshots/);
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('wires phase49 ops tick after phase48 and hub badges', () => {
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
      new URL('./marketing-phase49.ts', import.meta.url),
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
    expect(page).toMatch(/getPhase49RevenueOpsReport/);
    expect(page).toMatch(/Phase 49/);
    expect(page).toMatch(/phase49OpsReport=\{phase49OpsReport\.report\}/);
    expect(ui).toMatch(/dry.run/i);
    expect(ui).toMatch(/audit export/i);
    expect(worker).toMatch(/runPhase49RevenueOpsTick/);
    expect(worker).toMatch(/runPhase48RevenueOpsTick/);
    expect(worker.lastIndexOf('runPhase49RevenueOpsTick')).toBeGreaterThan(
      worker.lastIndexOf('runPhase48RevenueOpsTick'),
    );
    expect(lib).toMatch(/webhookUrl/);
    expect(lib).toMatch(/ops_alerts/);
    expect(lib).toMatch(/record_marketing_autopilot_dry_run_snapshot_phase49/);
    expect(lib).toMatch(/export_marketing_cohort_promotion_audit_phase49/);
    expect(lib).toMatch(/list_marketing_revenue_phase49_critical_windows/);
    expect(lib).toMatch(/record_marketing_revenue_phase49_ops_alert/);
    expect(lib).toMatch(/never_calls_promote/);
    expect(route).toMatch(/phase49-v1/);
  });

  it('never logs or stores secret values in phase49 surfaces', () => {
    const lib = readFileSync(
      new URL('./marketing-phase49.ts', import.meta.url),
      'utf8',
    );
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase49_marketing_revenue_ops.sql',
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
