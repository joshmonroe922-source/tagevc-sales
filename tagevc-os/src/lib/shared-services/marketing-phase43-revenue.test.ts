import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  REVENUE_BINDING_STATUSES,
  REVENUE_OPS_ALERT_DELIVERY,
  REVENUE_REPORT_VERSION_PHASE43,
} from './marketing-revenue-contracts';
import { emptyPhase43RevenueOpsReport } from './marketing-phase43';

describe('Phase 43 marketing credential binding and critical ops alerts', () => {
  it('shapes the phase43 ops report contract and empty helper', () => {
    const empty = emptyPhase43RevenueOpsReport();
    expect(empty.version).toBe(REVENUE_REPORT_VERSION_PHASE43);
    expect(empty.binding_health).toBe('unknown');
    expect(empty.alert_delivery).toBe('none');
    expect(empty.critical_alert_count).toBe(0);
    expect(empty.bindings).toEqual([]);
    expect(empty.alerts).toEqual([]);
    expect(empty.destination_key).toBe('ops_alerts');
    expect(REVENUE_BINDING_STATUSES).toContain('missing_credential');
    expect(REVENUE_OPS_ALERT_DELIVERY).toEqual([
      'delivered',
      'skipped_no_webhook',
      'failed',
      'recorded',
      'none',
    ]);
  });

  it('enforces phase43 SQL binding health, idempotent alerts, and grants', () => {
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase43_marketing_slo_ops_alerts.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sql).toMatch(/public\.os_sha256_hex/);
    expect(sql).toMatch(/search_path = public, extensions/);
    expect(sql).toMatch(/os_marketing_revenue_credential_binding_health/);
    expect(sql).toMatch(/os_marketing_revenue_slo_ops_alerts/);
    expect(sql).toMatch(/Marketing revenue Phase 43 ops evidence is append-only/);
    expect(sql).toMatch(/record_marketing_revenue_credential_binding_health/);
    expect(sql).toMatch(/list_marketing_revenue_phase43_critical_windows/);
    expect(sql).toMatch(/record_marketing_revenue_phase43_ops_alert/);
    expect(sql).toMatch(/get_marketing_revenue_phase43_ops_report/);
    expect(sql).toMatch(/phase43_credential_binding_status/);
    expect(sql).toMatch(/window_key text not null unique/);
    expect(sql).toMatch(/destination_key/);
    expect(sql).toMatch(/ops_alerts/);
    expect(sql).toMatch(/credential_env_name/);
    expect(sql).toMatch(/credential_env_present/);
    expect(sql).toMatch(/signature_env_present/);
    expect(sql).toMatch(/'value','env_value'/);
    expect(sql).toMatch(
      /check \(not \(metadata \?\| array\[\s*'authorization'/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.get_marketing_revenue_phase43_ops_report\(text,integer\)\s+to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.list_marketing_revenue_phase43_critical_windows\(text,integer,integer\)\s+to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_marketing_revenue_credential_binding_health\(jsonb\)\s+to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_marketing_revenue_phase43_ops_alert\(jsonb\)\s+to service_role/,
    );
    expect(sql).not.toMatch(/os_store_snapshots/);
    expect(sql).not.toMatch(/if\s+case\s+when/i);
    expect(sql).not.toMatch(
      /record_marketing_revenue_phase42_slo_snapshots/,
    );
  });

  it('wires phase43 ops tick after SLO snapshots and hub badges', () => {
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
      new URL('./marketing-phase43.ts', import.meta.url),
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
    expect(page).toMatch(/getPhase43RevenueOpsReport/);
    expect(page).toMatch(/Phase 4[34]/);
    expect(page).toMatch(/opsReport=\{opsReport\.report\}/);
    expect(ui).toMatch(/critical alerts/);
    expect(ui).toMatch(/credential binding/);
    expect(ui).toMatch(/alert_delivery/);
    expect(ui).toMatch(/binding_health/);
    expect(worker).toMatch(/runPhase43RevenueOpsTick/);
    expect(worker).toMatch(/record_marketing_revenue_phase42_slo_snapshots/);
    expect(worker.lastIndexOf('runPhase43RevenueOpsTick')).toBeGreaterThan(
      worker.indexOf('record_marketing_revenue_phase42_slo_snapshots'),
    );
    expect(lib).toMatch(/webhookUrl/);
    expect(lib).toMatch(/ops_alerts/);
    expect(lib).toMatch(/record_marketing_revenue_credential_binding_health/);
    expect(lib).toMatch(/list_marketing_revenue_phase43_critical_windows/);
    expect(lib).toMatch(/record_marketing_revenue_phase43_ops_alert/);
    expect(lib).toMatch(/credential_env_present/);
    expect(lib).not.toMatch(/process\.env\[source\.credential_env_name\]/);
    expect(route).toMatch(/phase4[34]-v1/);
    expect(route).toMatch(/critical_ops_alerts/);
  });

  it('never logs or stores secret values in phase43 surfaces', () => {
    const lib = readFileSync(
      new URL('./marketing-phase43.ts', import.meta.url),
      'utf8',
    );
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase43_marketing_slo_ops_alerts.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(lib).toMatch(/envPresent\(source\.credential_env_name\)/);
    expect(lib).toMatch(/value\.trim\(\)\.length > 0/);
    expect(lib).not.toMatch(/credential_env_value/);
    expect(lib).not.toMatch(/signature_env_value/);
    expect(sql).toMatch(/Never stores secret values/);
    expect(sql).toMatch(/'value','env_value'/);
  });
});
