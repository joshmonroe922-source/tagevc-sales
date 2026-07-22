import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  REVENUE_REPORT_VERSION_PHASE42,
  REVENUE_SLO_SEVERITIES,
} from './marketing-revenue-contracts';
import { emptyPhase42RevenueSloReport } from './marketing-phase42';

describe('Phase 42 production revenue SLOs', () => {
  it('shapes the phase42 SLO report contract and empty helper', () => {
    const empty = emptyPhase42RevenueSloReport();
    expect(empty.version).toBe(REVENUE_REPORT_VERSION_PHASE42);
    expect(REVENUE_SLO_SEVERITIES).toEqual([
      'healthy',
      'warning',
      'critical',
      'unknown',
    ]);
    expect(empty.authenticity_severity).toBe('unknown');
    expect(empty.settlement_severity).toBe('unknown');
    expect(empty.overall_severity).toBe('unknown');
    expect(empty.authenticity_snapshots).toEqual([]);
    expect(empty.settlement_snapshots).toEqual([]);
    expect(empty.thresholds.authenticity_fail_rate.warning).toBe(0.01);
    expect(empty.thresholds.settlement_rate.critical).toBe(0.15);
  });

  it('enforces phase42 SQL SLO snapshots, RPCs, and production_v1 gate', () => {
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase42_marketing_production_slos.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sql).toMatch(/public\.os_sha256_hex/);
    expect(sql).toMatch(/search_path = public, extensions/);
    expect(sql).toMatch(/os_marketing_revenue_authenticity_slo_snapshots/);
    expect(sql).toMatch(/os_marketing_revenue_settlement_slo_snapshots/);
    expect(sql).toMatch(/Marketing revenue Phase 42 SLO snapshots are append-only/);
    expect(sql).toMatch(/record_marketing_revenue_phase42_slo_snapshots/);
    expect(sql).toMatch(/get_marketing_revenue_phase42_slo_report/);
    expect(sql).toMatch(/phase42_authenticity_slo_severity/);
    expect(sql).toMatch(/phase42_settlement_slo_severity/);
    expect(sql).toMatch(
      /production_v1 requires HTTPS, production_ledger, and strong authenticity/,
    );
    expect(sql).toMatch(/hmac_sha256','signed_headers_v1','jwt_bearer_v1/);
    expect(sql).toMatch(/to_regclass\('public\.os_marketing_paid_revenue_evidence'\)/);
    expect(sql).toMatch(
      /grant execute on function public\.get_marketing_revenue_phase42_slo_report\(text,integer\)\s+to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_marketing_revenue_phase42_slo_snapshots\(text,integer,text\)\s+to service_role/,
    );
    expect(sql).not.toMatch(/os_store_snapshots/);
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('wires phase42 SLO report and production ticks into marketing surfaces', () => {
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
    expect(page).toMatch(/getPhase42RevenueSloReport/);
    expect(page).toMatch(/Phase 4[2-7]/);
    expect(page).toMatch(/sloReport=\{productionSlos\.report\}/);
    expect(ui).toMatch(/Production SLOs/);
    expect(ui).toMatch(/authenticity_severity/);
    expect(ui).toMatch(/settlement_severity/);
    expect(worker).toMatch(/record_marketing_revenue_phase42_slo_snapshots/);
    expect(worker).toMatch(/production_v1/);
    expect(worker).toMatch(/ledger_profile/);
    expect(route).toMatch(/phase4[3-7]-v1/);
    expect(route).toMatch(/production_slo_ticks/);
  });
});
