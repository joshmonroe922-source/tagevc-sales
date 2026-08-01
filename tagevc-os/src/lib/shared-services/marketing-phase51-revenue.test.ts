import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  REVENUE_REPORT_VERSION_PHASE51,
  emptyPhase51RevenueOpsReport,
} from './marketing-phase51';

describe('Phase 51 marketing revenue ops', () => {
  it('shapes the phase51 ops report contract and empty helper', () => {
    const empty = emptyPhase51RevenueOpsReport();
    expect(empty.version).toBe(REVENUE_REPORT_VERSION_PHASE51);
    expect(empty.auto_propose_created_count).toBe(0);
    expect(empty.auto_propose_skipped_count).toBe(0);
    expect(empty.auto_propose_errored_count).toBe(0);
    expect(empty.auto_propose_runs).toEqual([]);
    expect(empty.cohort_status).toEqual([]);
    expect(empty.alerts).toEqual([]);
    expect(empty.destination_key).toBe('ops_alerts');
    expect(empty.never_auto_approves_money).toBe(true);
    expect(empty.never_auto_approves).toBe(true);
    expect(REVENUE_REPORT_VERSION_PHASE51).toBe('phase51-v1');
  });

  it('enforces phase51 SQL tables, auto-propose-only RPC, and grants', () => {
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase51_marketing_revenue_ops.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sql).toMatch(/Phase 51/);
    expect(sql).toMatch(/phase50_marketing_revenue_ops\.sql/);
    expect(sql).toMatch(/public\.os_sha256_hex/);
    expect(sql).toMatch(/search_path = public, extensions/);
    expect(sql).toMatch(/os_marketing_revenue_phase51_auto_propose_runs/);
    expect(sql).toMatch(/os_marketing_revenue_phase51_ops_alerts/);
    expect(sql).toMatch(/Marketing revenue Phase 51 ops evidence is append-only/);
    expect(sql).toMatch(/phase51_marketing_ops_safe_metadata/);
    expect(sql).toMatch(/auto_propose_marketing_dry_run_promote_phase51/);
    expect(sql).toMatch(/list_marketing_revenue_phase51_critical_windows/);
    expect(sql).toMatch(/record_marketing_revenue_phase51_ops_alert/);
    expect(sql).toMatch(/get_marketing_revenue_phase51_ops_report/);
    expect(sql).toMatch(/phase51-v1/);
    expect(sql).toMatch(/NEVER auto-approves[\s\S]{0,20}money/);
    expect(sql).toMatch(/never_auto_approves_money/);
    expect(sql).toMatch(/never_auto_approves/);
    expect(sql).not.toMatch(/os_store_snapshots/);
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('auto-propose ONLY ever calls the existing Phase 50 propose RPC — never approve/promote', () => {
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase51_marketing_revenue_ops.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sql).toMatch(/propose_marketing_dry_run_promote_phase50/);
    // The only mention of the approve RPC is in a comment stating it is
    // NEVER called — there must be no actual call site (no `:=` assignment
    // or bare invocation).
    expect(sql).not.toMatch(/:=\s*public\.approve_marketing_dry_run_promote_phase50/);
    expect(sql).not.toMatch(/perform public\.approve_marketing_dry_run_promote_phase50/i);
    expect(sql).not.toMatch(/promote_marketing_auto_reject_cohort_phase47/);
    expect(sql).not.toMatch(/review_marketing_revenue_correction/);
    expect(sql).toMatch(/NEVER calls[\s\S]{0,80}approve_marketing_dry_run_promote_phase50/);
    expect(sql).toMatch(/two distinct humans must still review and approve/i);
  });

  it('requires N consecutive ready readiness snapshots before proposing, and is idempotent per cohort/day', () => {
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase51_marketing_revenue_ops.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sql).toMatch(/v_streak < v_windows_required/);
    expect(sql).toMatch(/skipped_insufficient_streak/);
    expect(sql).toMatch(/skipped_already_pending/);
    expect(sql).toMatch(/skipped_no_dry_run/);
    expect(sql).toMatch(/on conflict \(run_key\) do nothing/);
    expect(sql).toMatch(
      /os_marketing_revenue_cohort_readiness_snapshots[\s\S]*where cohort_id = v_cohort\.cohort_id/,
    );
  });

  it('grants report execute to authenticated+service_role, mutation execute to service_role', () => {
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase51_marketing_revenue_ops.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sql).toMatch(
      /grant execute on function public\.get_marketing_revenue_phase51_ops_report\(integer\)\s*\n\s*to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.auto_propose_marketing_dry_run_promote_phase51\(uuid,integer\)\s*\n\s*to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_marketing_revenue_phase51_ops_alert\(jsonb\)\s*\n\s*to service_role/,
    );
  });

  it('wires runPhase51RevenueOpsTick after phase50 in the worker, hub page badge, and UI', () => {
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
      new URL('./marketing-phase51.ts', import.meta.url),
      'utf8',
    );
    const ui = readFileSync(
      new URL(
        '../../components/shared-services/marketing-revenue-phase41.tsx',
        import.meta.url,
      ),
      'utf8',
    );
    expect(page).toMatch(/getPhase51RevenueOpsReport/);
    expect(page).toMatch(/phase51OpsReport=\{phase51OpsReport\.report\}/);
    expect(ui).toMatch(/auto-propose/i);
    expect(ui).toMatch(/never auto-approv/i);
    expect(worker).toMatch(/runPhase51RevenueOpsTick/);
    expect(worker).toMatch(/runPhase50RevenueOpsTick/);
    expect(worker.lastIndexOf('runPhase51RevenueOpsTick')).toBeGreaterThan(
      worker.lastIndexOf('runPhase50RevenueOpsTick'),
    );
    expect(lib).toMatch(/webhookUrl/);
    expect(lib).toMatch(/ops_alerts/);
    expect(lib).toMatch(/auto_propose_marketing_dry_run_promote_phase51/);
    expect(lib).toMatch(/list_marketing_revenue_phase51_critical_windows/);
    expect(lib).toMatch(/never_auto_approves_money/);
  });

  it('never logs or stores secret values in phase51 surfaces', () => {
    const lib = readFileSync(
      new URL('./marketing-phase51.ts', import.meta.url),
      'utf8',
    );
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase51_marketing_revenue_ops.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(lib).not.toMatch(/credential_env_value/);
    expect(lib).not.toMatch(/signature_env_value/);
    expect(lib).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY\]/);
    expect(sql).not.toMatch(/os_store_snapshots/);
  });
});
