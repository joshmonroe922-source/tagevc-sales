import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  REVENUE_ATTRIBUTION_CONFLICT_KINDS,
  REVENUE_CORRECTION_VALIDATION_STATUSES,
  REVENUE_RECONCILIATION_STATUSES,
  REVENUE_REPORT_VERSION_PHASE44,
} from './marketing-revenue-contracts';
import { emptyPhase44RevenueOpsReport } from './marketing-phase44';

describe('Phase 44 marketing revenue ops', () => {
  it('shapes the phase44 ops report contract and empty helper', () => {
    const empty = emptyPhase44RevenueOpsReport();
    expect(empty.version).toBe(REVENUE_REPORT_VERSION_PHASE44);
    expect(empty.correction_validation_health).toBe('unknown');
    expect(empty.conflict_open_count).toBe(0);
    expect(empty.recon_health).toBe('unknown');
    expect(empty.alert_delivery).toBe('none');
    expect(empty.validations).toEqual([]);
    expect(empty.conflicts).toEqual([]);
    expect(empty.snapshots).toEqual([]);
    expect(empty.alerts).toEqual([]);
    expect(empty.destination_key).toBe('ops_alerts');
    expect(REVENUE_CORRECTION_VALIDATION_STATUSES).toContain('auto_rejected');
    expect(REVENUE_ATTRIBUTION_CONFLICT_KINDS).toEqual([
      'event_set_mismatch',
      'amount_delta_threshold',
      'model_count_gap',
    ]);
    expect(REVENUE_RECONCILIATION_STATUSES).toContain(
      'denominator_inconsistent',
    );
  });

  it('enforces phase44 SQL tables, fail-closed validation, and grants', () => {
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase44_marketing_revenue_ops.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sql).toMatch(/Phase 44/);
    expect(sql).toMatch(/phase43_marketing_slo_ops_alerts\.sql/);
    expect(sql).toMatch(/public\.os_sha256_hex/);
    expect(sql).toMatch(/search_path = public, extensions/);
    expect(sql).toMatch(/os_marketing_revenue_correction_validations/);
    expect(sql).toMatch(/os_marketing_revenue_attribution_conflicts/);
    expect(sql).toMatch(/os_marketing_revenue_reconciliation_snapshots/);
    expect(sql).toMatch(/os_marketing_revenue_phase44_ops_alerts/);
    expect(sql).toMatch(/Marketing revenue Phase 44 ops evidence is append-only/);
    expect(sql).toMatch(/validate_marketing_revenue_corrections_phase44/);
    expect(sql).toMatch(/detect_marketing_revenue_attribution_conflicts_phase44/);
    expect(sql).toMatch(/propose_resolve_marketing_attribution_conflict_phase44/);
    expect(sql).toMatch(/record_marketing_revenue_reconciliation_snapshots_phase44/);
    expect(sql).toMatch(/list_marketing_revenue_phase44_critical_windows/);
    expect(sql).toMatch(/record_marketing_revenue_phase44_ops_alert/);
    expect(sql).toMatch(/get_marketing_revenue_phase44_ops_report/);
    expect(sql).toMatch(/phase44-v1/);
    expect(sql).toMatch(/NEVER auto-approves/);
    expect(sql).toMatch(/approve_marketing_revenue_correction/);
    expect(sql).toMatch(/'rejected'/);
    expect(sql).toMatch(/Maker-checker requires a different actor/);
    expect(sql).toMatch(/event_set_sha256/);
    expect(sql).toMatch(/conflict_key text not null unique/);
    expect(sql).toMatch(/window_key text not null unique/);
    expect(sql).toMatch(/correction_queue_critical/);
    expect(sql).toMatch(/late_records_critical/);
    expect(sql).toMatch(
      /grant execute on function public\.get_marketing_revenue_phase44_ops_report\(text,integer\)\s+to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.propose_resolve_marketing_attribution_conflict_phase44\(uuid,text,text,uuid\)\s+to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.validate_marketing_revenue_corrections_phase44\(\)\s+to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_marketing_revenue_phase44_ops_alert\(jsonb\)\s+to service_role/,
    );
    expect(sql).not.toMatch(/os_store_snapshots/);
    expect(sql).not.toMatch(/if\s+case\s+when/i);
    expect(sql).not.toMatch(/p_decision\s*=\s*'approved'/);
  });

  it('wires phase44 ops tick after phase43 and hub badges', () => {
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
      new URL('./marketing-phase44.ts', import.meta.url),
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
    const actions = readFileSync(
      new URL(
        '../../app/(app)/shared-services/marketing/actions.ts',
        import.meta.url,
      ),
      'utf8',
    );
    expect(page).toMatch(/getPhase44RevenueOpsReport/);
    expect(page).toMatch(/Phase 4[4-8]/);
    expect(page).toMatch(/phase44OpsReport=\{phase44OpsReport\.report\}/);
    expect(ui).toMatch(/correction validation/);
    expect(ui).toMatch(/open conflicts/);
    expect(ui).toMatch(/recon health/);
    expect(ui).toMatch(/credential binding/);
    expect(ui).toMatch(/resolveMarketingAttributionConflictAction/);
    expect(actions).toMatch(/resolveMarketingAttributionConflictAction/);
    expect(actions).toMatch(/proposeResolveAttributionConflict/);
    expect(worker).toMatch(/runPhase44RevenueOpsTick/);
    expect(worker).toMatch(/runPhase43RevenueOpsTick/);
    expect(worker.lastIndexOf('runPhase44RevenueOpsTick')).toBeGreaterThan(
      worker.lastIndexOf('runPhase43RevenueOpsTick'),
    );
    expect(lib).toMatch(/webhookUrl/);
    expect(lib).toMatch(/ops_alerts/);
    expect(lib).toMatch(/validate_marketing_revenue_corrections_phase44/);
    expect(lib).toMatch(/detect_marketing_revenue_attribution_conflicts_phase44/);
    expect(lib).toMatch(/record_marketing_revenue_reconciliation_snapshots_phase44/);
    expect(lib).toMatch(/list_marketing_revenue_phase44_critical_windows/);
    expect(lib).toMatch(/record_marketing_revenue_phase44_ops_alert/);
    expect(lib).toMatch(/proposeResolveAttributionConflict/);
    expect(route).toMatch(/phase4[4-8]-v1/);
    expect(route).toMatch(/correction_validation/);
    expect(route).toMatch(/attribution_conflicts/);
  });

  it('never logs or stores secret values in phase44 surfaces', () => {
    const lib = readFileSync(
      new URL('./marketing-phase44.ts', import.meta.url),
      'utf8',
    );
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase44_marketing_revenue_ops.sql',
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
