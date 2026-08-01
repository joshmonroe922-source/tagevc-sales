import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  REVENUE_PHASE47_ALERT_KINDS,
  REVENUE_REPORT_VERSION_PHASE47,
} from './marketing-revenue-contracts';
import { emptyPhase47RevenueOpsReport } from './marketing-phase47';

describe('Phase 47 marketing revenue ops', () => {
  it('shapes the phase47 ops report contract and empty helper', () => {
    const empty = emptyPhase47RevenueOpsReport();
    expect(empty.version).toBe(REVENUE_REPORT_VERSION_PHASE47);
    expect(empty.cohort_gate_health).toBe('unknown');
    expect(empty.conflict_aging_health).toBe('unknown');
    expect(empty.closure_health).toBe('unknown');
    expect(empty.alert_delivery).toBe('none');
    expect(empty.open_aging_count).toBe(0);
    expect(empty.pending_closure_count).toBe(0);
    expect(empty.cohort_gate).toBeNull();
    expect(empty.cohorts).toEqual([]);
    expect(empty.cohort_promotions).toEqual([]);
    expect(empty.conflict_closures).toEqual([]);
    expect(empty.aging_conflicts).toEqual([]);
    expect(empty.alerts).toEqual([]);
    expect(empty.destination_key).toBe('ops_alerts');
    expect(REVENUE_PHASE47_ALERT_KINDS).toEqual([
      'cohort_promotion_blocked',
      'cohort_promoted',
      'attribution_conflict_aging',
      'conflict_closure_pending',
    ]);
  });

  it('enforces phase47 SQL tables, cohort gates, closures, and grants', () => {
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase47_marketing_revenue_ops.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sql).toMatch(/Phase 47/);
    expect(sql).toMatch(/phase46_marketing_revenue_ops\.sql/);
    expect(sql).toMatch(/public\.os_sha256_hex/);
    expect(sql).toMatch(/search_path = public, extensions/);
    expect(sql).toMatch(/os_marketing_revenue_promotion_cohorts/);
    expect(sql).toMatch(/os_marketing_revenue_cohort_promotions/);
    expect(sql).toMatch(/os_marketing_revenue_attribution_conflict_closures/);
    expect(sql).toMatch(/os_marketing_revenue_phase47_ops_alerts/);
    expect(sql).toMatch(/Marketing revenue Phase 47 ops evidence is append-only/);
    expect(sql).toMatch(/phase47_marketing_ops_safe_metadata/);
    expect(sql).toMatch(/upsert_marketing_promotion_cohort_phase47/);
    expect(sql).toMatch(/evaluate_marketing_cohort_promotion_gate_phase47/);
    expect(sql).toMatch(/promote_marketing_auto_reject_cohort_phase47/);
    expect(sql).toMatch(/detect_marketing_attribution_conflicts_aging_phase47/);
    expect(sql).toMatch(/list_marketing_open_attribution_conflicts_aging_phase47/);
    expect(sql).toMatch(/propose_close_marketing_attribution_conflict_phase47/);
    expect(sql).toMatch(/review_close_marketing_attribution_conflict_phase47/);
    expect(sql).toMatch(/list_marketing_revenue_phase47_critical_windows/);
    expect(sql).toMatch(/record_marketing_revenue_phase47_ops_alert/);
    expect(sql).toMatch(/get_marketing_revenue_phase47_ops_report/);
    expect(sql).toMatch(/phase47-v1/);
    expect(sql).toMatch(/NEVER auto-approves/);
    expect(sql).toMatch(/promote_marketing_auto_reject_rule_phase46/);
    expect(sql).toMatch(/evaluate_marketing_auto_reject_promotion_gate_phase46/);
    expect(sql).toMatch(/'active','retired'/);
    expect(sql).toMatch(/'proposed','approved','rejected','closed'/);
    expect(sql).toMatch(/cohort_promotion_blocked/);
    expect(sql).toMatch(/cohort_promoted/);
    expect(sql).toMatch(/attribution_conflict_aging/);
    expect(sql).toMatch(/conflict_closure_pending/);
    expect(sql).toMatch(/window_key text not null unique/);
    expect(sql).toMatch(/Maker-checker requires a different actor/);
    expect(sql).toMatch(
      /grant execute on function public\.get_marketing_revenue_phase47_ops_report\(text,integer\)\s+to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.evaluate_marketing_cohort_promotion_gate_phase47\(jsonb\)\s+to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.promote_marketing_auto_reject_cohort_phase47\(jsonb\)\s+to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_marketing_revenue_phase47_ops_alert\(jsonb\)\s+to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.propose_close_marketing_attribution_conflict_phase47\(uuid,text,uuid,jsonb\)\s+to authenticated, service_role/,
    );
    expect(sql).not.toMatch(/os_store_snapshots/);
    expect(sql).not.toMatch(/if\s+case\s+when/i);
    expect(sql).not.toMatch(/p_decision\s*=\s*'approved'/);
  });

  it('wires phase47 ops tick after phase46 and hub badges', () => {
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
      new URL('./marketing-phase47.ts', import.meta.url),
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
    expect(page).toMatch(/getPhase47RevenueOpsReport/);
    expect(page).toMatch(/phase47OpsReport=\{phase47OpsReport\.report\}/);
    expect(ui).toMatch(/cohort gate/);
    expect(ui).toMatch(/conflict aging/);
    expect(ui).toMatch(/conflict closures/);
    expect(worker).toMatch(/runPhase47RevenueOpsTick/);
    expect(worker).toMatch(/runPhase46RevenueOpsTick/);
    expect(worker.lastIndexOf('runPhase47RevenueOpsTick')).toBeGreaterThan(
      worker.lastIndexOf('runPhase46RevenueOpsTick'),
    );
    expect(lib).toMatch(/webhookUrl/);
    expect(lib).toMatch(/ops_alerts/);
    expect(lib).toMatch(/detect_marketing_attribution_conflicts_aging_phase47/);
    expect(lib).toMatch(/list_marketing_revenue_phase47_critical_windows/);
    expect(lib).toMatch(/record_marketing_revenue_phase47_ops_alert/);
    expect(route).toMatch(/phase48-v1/);
    expect(route).toMatch(/cohort_promotion_gates/);
    expect(route).toMatch(/attribution_conflict_closures/);
    expect(route).toMatch(/conflict_aging_visibility/);
  });

  it('never logs or stores secret values in phase47 surfaces', () => {
    const lib = readFileSync(
      new URL('./marketing-phase47.ts', import.meta.url),
      'utf8',
    );
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase47_marketing_revenue_ops.sql',
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
