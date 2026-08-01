import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  REVENUE_PHASE48_ALERT_KINDS,
  REVENUE_REPORT_VERSION_PHASE48,
} from './marketing-revenue-contracts';
import { emptyPhase48RevenueOpsReport } from './marketing-phase48';

describe('Phase 48 marketing revenue ops', () => {
  it('shapes the phase48 ops report contract and empty helper', () => {
    const empty = emptyPhase48RevenueOpsReport();
    expect(empty.version).toBe(REVENUE_REPORT_VERSION_PHASE48);
    expect(empty.autopilot_health).toBe('unknown');
    expect(empty.archive_health).toBe('unknown');
    expect(empty.cohort_performance_health).toBe('unknown');
    expect(empty.conflict_resolution_health).toBe('unknown');
    expect(empty.alert_delivery).toBe('none');
    expect(empty.autopilot_waiting_count).toBe(0);
    expect(empty.autopilot_promoted_count).toBe(0);
    expect(empty.autopilot_blocked_count).toBe(0);
    expect(empty.archives_count).toBe(0);
    expect(empty.open_aging_count).toBe(0);
    expect(empty.pending_closure_count).toBe(0);
    expect(empty.autopilot_runs).toEqual([]);
    expect(empty.conflict_archives).toEqual([]);
    expect(empty.performance_snapshots).toEqual([]);
    expect(empty.aging_conflicts).toEqual([]);
    expect(empty.alerts).toEqual([]);
    expect(empty.destination_key).toBe('ops_alerts');
    expect(REVENUE_PHASE48_ALERT_KINDS).toEqual([
      'autopilot_promoted',
      'autopilot_blocked',
      'conflict_cohort_archived',
      'cohort_performance_degraded',
    ]);
  });

  it('enforces phase48 SQL tables, autopilot, archives, and grants', () => {
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase48_marketing_revenue_ops.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sql).toMatch(/Phase 48/);
    expect(sql).toMatch(/phase47_marketing_revenue_ops\.sql/);
    expect(sql).toMatch(/public\.os_sha256_hex/);
    expect(sql).toMatch(/search_path = public, extensions/);
    expect(sql).toMatch(/os_marketing_revenue_cohort_autopilot_runs/);
    expect(sql).toMatch(/os_marketing_revenue_conflict_cohort_archives/);
    expect(sql).toMatch(/os_marketing_revenue_cohort_performance_snapshots/);
    expect(sql).toMatch(/os_marketing_revenue_phase48_ops_alerts/);
    expect(sql).toMatch(/Marketing revenue Phase 48 ops evidence is append-only/);
    expect(sql).toMatch(/phase48_marketing_ops_safe_metadata/);
    expect(sql).toMatch(/run_marketing_cohort_autopilot_phase48/);
    expect(sql).toMatch(/archive_marketing_closed_conflict_cohorts_phase48/);
    expect(sql).toMatch(/record_marketing_cohort_performance_snapshot_phase48/);
    expect(sql).toMatch(/list_marketing_open_attribution_conflicts_aging_phase48/);
    expect(sql).toMatch(/list_marketing_revenue_phase48_critical_windows/);
    expect(sql).toMatch(/record_marketing_revenue_phase48_ops_alert/);
    expect(sql).toMatch(/get_marketing_revenue_phase48_ops_report/);
    expect(sql).toMatch(/phase48-v1/);
    expect(sql).toMatch(/NEVER auto-approves/);
    expect(sql).toMatch(/never_auto_approves_money/);
    expect(sql).toMatch(/promote_marketing_auto_reject_cohort_phase47/);
    expect(sql).toMatch(/evaluate_marketing_cohort_promotion_gate_phase47/);
    expect(sql).toMatch(/soft_hidden/);
    expect(sql).toMatch(/phase48_conflict_is_archived/);
    expect(sql).toMatch(/'waiting','promoted','blocked','skipped'/);
    expect(sql).toMatch(/autopilot_promoted/);
    expect(sql).toMatch(/autopilot_blocked/);
    expect(sql).toMatch(/conflict_cohort_archived/);
    expect(sql).toMatch(/cohort_performance_degraded/);
    expect(sql).toMatch(/window_key text not null unique/);
    expect(sql).toMatch(/autopilot_consecutive_windows_required/);
    expect(sql).toMatch(
      /grant execute on function public\.get_marketing_revenue_phase48_ops_report\(text,integer\)\s+to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.run_marketing_cohort_autopilot_phase48\(jsonb\)\s+to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.archive_marketing_closed_conflict_cohorts_phase48\(jsonb\)\s+to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_marketing_revenue_phase48_ops_alert\(jsonb\)\s+to service_role/,
    );
    expect(sql).not.toMatch(/os_store_snapshots/);
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('wires phase48 ops tick after phase47 and hub badges', () => {
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
      new URL('./marketing-phase48.ts', import.meta.url),
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
    expect(page).toMatch(/getPhase48RevenueOpsReport/);
    expect(page).toMatch(/phase48OpsReport=\{phase48OpsReport\.report\}/);
    expect(ui).toMatch(/cohort autopilot/);
    expect(ui).toMatch(/cohort performance/);
    expect(ui).toMatch(/conflict resolution/);
    expect(worker).toMatch(/runPhase48RevenueOpsTick/);
    expect(worker).toMatch(/runPhase47RevenueOpsTick/);
    expect(worker.lastIndexOf('runPhase48RevenueOpsTick')).toBeGreaterThan(
      worker.lastIndexOf('runPhase47RevenueOpsTick'),
    );
    expect(lib).toMatch(/webhookUrl/);
    expect(lib).toMatch(/ops_alerts/);
    expect(lib).toMatch(/run_marketing_cohort_autopilot_phase48/);
    expect(lib).toMatch(/archive_marketing_closed_conflict_cohorts_phase48/);
    expect(lib).toMatch(/record_marketing_cohort_performance_snapshot_phase48/);
    expect(lib).toMatch(/list_marketing_revenue_phase48_critical_windows/);
    expect(lib).toMatch(/record_marketing_revenue_phase48_ops_alert/);
    expect(route).toMatch(/phase48-v1/);
    expect(route).toMatch(/cohort_autopilot/);
    expect(route).toMatch(/conflict_cohort_archives/);
    expect(route).toMatch(/cohort_performance_snapshots/);
  });

  it('never logs or stores secret values in phase48 surfaces', () => {
    const lib = readFileSync(
      new URL('./marketing-phase48.ts', import.meta.url),
      'utf8',
    );
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase48_marketing_revenue_ops.sql',
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
