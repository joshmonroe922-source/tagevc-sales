import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  REVENUE_PHASE50_ALERT_KINDS,
  REVENUE_REPORT_VERSION_PHASE50,
} from './marketing-revenue-contracts';
import { emptyPhase50RevenueOpsReport } from './marketing-phase50';

describe('Phase 50 marketing revenue ops', () => {
  it('shapes the phase50 ops report contract and empty helper', () => {
    const empty = emptyPhase50RevenueOpsReport();
    expect(empty.version).toBe(REVENUE_REPORT_VERSION_PHASE50);
    expect(empty.promotion_health).toBe('unknown');
    expect(empty.alert_delivery).toBe('none');
    expect(empty.pending_proposal_count).toBe(0);
    expect(empty.applied_proposal_count).toBe(0);
    expect(empty.blocked_proposal_count).toBe(0);
    expect(empty.rejected_proposal_count).toBe(0);
    expect(empty.proposals).toEqual([]);
    expect(empty.cohort_readiness).toEqual([]);
    expect(empty.alerts).toEqual([]);
    expect(empty.destination_key).toBe('ops_alerts');
    expect(empty.never_auto_approves_money).toBe(true);
    expect(REVENUE_PHASE50_ALERT_KINDS).toEqual([
      'promotion_proposal_awaiting_second_approval',
      'promotion_proposal_applied',
      'cohort_readiness_blocked',
    ]);
  });

  it('enforces phase50 SQL tables, dual-approve gate, and grants', () => {
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase50_marketing_revenue_ops.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sql).toMatch(/Phase 50/);
    expect(sql).toMatch(/phase49_marketing_revenue_ops\.sql/);
    expect(sql).toMatch(/public\.os_sha256_hex/);
    expect(sql).toMatch(/search_path = public, extensions/);
    expect(sql).toMatch(/os_marketing_revenue_dry_run_promotion_proposals/);
    expect(sql).toMatch(/os_marketing_revenue_dry_run_promotion_approvals/);
    expect(sql).toMatch(/os_marketing_revenue_cohort_readiness_snapshots/);
    expect(sql).toMatch(/os_marketing_revenue_phase50_ops_alerts/);
    expect(sql).toMatch(/Marketing revenue Phase 50 ops evidence is append-only/);
    expect(sql).toMatch(/phase50_marketing_ops_safe_metadata/);
    expect(sql).toMatch(/propose_marketing_dry_run_promote_phase50/);
    expect(sql).toMatch(/approve_marketing_dry_run_promote_phase50/);
    expect(sql).toMatch(/record_marketing_cohort_readiness_snapshot_phase50/);
    expect(sql).toMatch(/list_marketing_revenue_phase50_critical_windows/);
    expect(sql).toMatch(/record_marketing_revenue_phase50_ops_alert/);
    expect(sql).toMatch(/get_marketing_revenue_phase50_ops_report/);
    expect(sql).toMatch(/phase50-v1/);
    expect(sql).toMatch(/NEVER auto-approves money/);
    expect(sql).toMatch(/never_auto_approves_money/);
    expect(sql).toMatch(/count\(distinct actor_id\)/);
    expect(sql).toMatch(/v_distinct_approvers < 2/);
    expect(sql).toMatch(/proposer may not also approve/i);
    expect(sql).toMatch(/promote_marketing_auto_reject_cohort_phase47/);
    expect(sql).not.toMatch(
      /:=\s*public\.review_marketing_revenue_correction/,
    );
    expect(sql).toMatch(/promotion_proposal_awaiting_second_approval/);
    expect(sql).toMatch(/promotion_proposal_applied/);
    expect(sql).toMatch(/cohort_readiness_blocked/);
    expect(sql).toMatch(
      /status text not null check \(status in\s*\n\s*\('pending','approved','rejected','blocked','applied'\)\)/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.get_marketing_revenue_phase50_ops_report\(text,integer\)\s+to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.propose_marketing_dry_run_promote_phase50\(jsonb\)\s+to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.approve_marketing_dry_run_promote_phase50\(uuid,uuid,text,jsonb\)\s+to authenticated, service_role/,
    );
    expect(sql).not.toMatch(/os_store_snapshots/);
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('wires phase50 ops tick after phase49 and hub badges', () => {
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
      new URL('./marketing-phase50.ts', import.meta.url),
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
    expect(page).toMatch(/getPhase50RevenueOpsReport/);
    expect(page).toMatch(/Phase 50/);
    expect(page).toMatch(/phase50OpsReport=\{phase50OpsReport\.report\}/);
    expect(ui).toMatch(/dual-approve promotion/i);
    expect(ui).toMatch(/never auto-approv/i);
    expect(worker).toMatch(/runPhase50RevenueOpsTick/);
    expect(worker).toMatch(/runPhase49RevenueOpsTick/);
    expect(worker.lastIndexOf('runPhase50RevenueOpsTick')).toBeGreaterThan(
      worker.lastIndexOf('runPhase49RevenueOpsTick'),
    );
    expect(lib).toMatch(/webhookUrl/);
    expect(lib).toMatch(/ops_alerts/);
    expect(lib).toMatch(/propose_marketing_dry_run_promote_phase50/);
    expect(lib).toMatch(/approve_marketing_dry_run_promote_phase50/);
    expect(lib).toMatch(/record_marketing_cohort_readiness_snapshot_phase50/);
    expect(lib).toMatch(/list_marketing_revenue_phase50_critical_windows/);
    expect(lib).toMatch(/never_auto_approves_money/);
    expect(route).toMatch(/phase50-v1/);
    expect(actions).toMatch(/proposeMarketingDryRunPromoteAction/);
    expect(actions).toMatch(/approveMarketingDryRunPromoteAction/);
  });

  it('never logs or stores secret values in phase50 surfaces', () => {
    const lib = readFileSync(
      new URL('./marketing-phase50.ts', import.meta.url),
      'utf8',
    );
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase50_marketing_revenue_ops.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(lib).not.toMatch(/credential_env_value/);
    expect(lib).not.toMatch(/signature_env_value/);
    expect(lib).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY\]/);
    expect(sql).toMatch(/'value','env_value'/);
    expect(sql).not.toMatch(/os_store_snapshots/);
  });
});
