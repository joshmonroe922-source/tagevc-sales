import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  REVENUE_REPORT_VERSION_PHASE52,
  emptyPhase52RevenueOpsReport,
} from './marketing-phase52';

describe('Phase 52 marketing revenue ops', () => {
  it('shapes the phase52 ops report contract and empty helper', () => {
    const empty = emptyPhase52RevenueOpsReport();
    expect(empty.version).toBe(REVENUE_REPORT_VERSION_PHASE52);
    expect(empty.awaiting_first_approval_count).toBe(0);
    expect(empty.awaiting_second_approval_count).toBe(0);
    expect(empty.total_pending_count).toBe(0);
    expect(empty.pending_items).toEqual([]);
    expect(empty.recent_digests).toEqual([]);
    expect(empty.alerts).toEqual([]);
    expect(empty.destination_key).toBe('ops_alerts');
    expect(empty.never_auto_approves_money).toBe(true);
    expect(empty.never_auto_approves).toBe(true);
    expect(REVENUE_REPORT_VERSION_PHASE52).toBe('phase52-v1');
  });

  it('enforces phase52 SQL tables, digest-only RPC, and grants', () => {
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase52_marketing_revenue_ops.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sql).toMatch(/Phase 52/);
    expect(sql).toMatch(/phase51_marketing_revenue_ops\.sql/);
    expect(sql).toMatch(/public\.os_sha256_hex/);
    expect(sql).toMatch(/search_path = public, extensions/);
    expect(sql).toMatch(/os_marketing_revenue_phase52_pending_digest_snapshots/);
    expect(sql).toMatch(/os_marketing_revenue_phase52_ops_alerts/);
    expect(sql).toMatch(/Marketing revenue Phase 52 ops evidence is append-only/);
    expect(sql).toMatch(/phase52_marketing_ops_safe_metadata/);
    expect(sql).toMatch(/record_marketing_pending_proposals_digest_phase52/);
    expect(sql).toMatch(/list_marketing_pending_proposals_phase52/);
    expect(sql).toMatch(/list_marketing_revenue_phase52_critical_windows/);
    expect(sql).toMatch(/record_marketing_revenue_phase52_ops_alert/);
    expect(sql).toMatch(/get_marketing_revenue_phase52_ops_report/);
    expect(sql).toMatch(/phase52-v1/);
    expect(sql).toMatch(/NEVER auto-approves[\s\S]{0,20}money/);
    expect(sql).toMatch(/never_auto_approves_money/);
    expect(sql).toMatch(/awaiting_first_approval/);
    expect(sql).toMatch(/awaiting_second_approval/);
    expect(sql).not.toMatch(/os_store_snapshots/);
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('digest ONLY ever reads pending proposals — never approve/promote', () => {
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase52_marketing_revenue_ops.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sql).not.toMatch(/:=\s*public\.approve_marketing_dry_run_promote_phase50/);
    expect(sql).not.toMatch(/perform public\.approve_marketing_dry_run_promote_phase50/i);
    expect(sql).not.toMatch(/:=\s*public\.auto_propose_marketing_dry_run_promote_phase51/);
    expect(sql).not.toMatch(/promote_marketing_auto_reject_cohort_phase47/);
    expect(sql).toMatch(/NEVER calls[\s\S]{0,80}approve_marketing_dry_run_promote_phase50/);
  });

  it('grants report execute to authenticated+service_role, mutation execute to service_role', () => {
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase52_marketing_revenue_ops.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sql).toMatch(
      /grant execute on function public\.get_marketing_revenue_phase52_ops_report\(integer\)\s*\n\s*to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_marketing_pending_proposals_digest_phase52\(jsonb\)\s*\n\s*to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_marketing_revenue_phase52_ops_alert\(jsonb\)\s*\n\s*to service_role/,
    );
  });

  it('wires runPhase52RevenueOpsTick after phase51 in the worker, hub page badge, and UI', () => {
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
      new URL('./marketing-phase52.ts', import.meta.url),
      'utf8',
    );
    const ui = readFileSync(
      new URL(
        '../../components/shared-services/marketing-revenue-phase41.tsx',
        import.meta.url,
      ),
      'utf8',
    );
    expect(page).toMatch(/getPhase52RevenueOpsReport/);
    expect(page).toMatch(/Phase 52/);
    expect(page).toMatch(/phase52OpsReport=\{phase52OpsReport\.report\}/);
    expect(ui).toMatch(/pending.?proposal/i);
    expect(ui).toMatch(/never auto-approv/i);
    expect(worker).toMatch(/runPhase52RevenueOpsTick/);
    expect(worker).toMatch(/runPhase51RevenueOpsTick/);
    expect(worker.lastIndexOf('runPhase52RevenueOpsTick')).toBeGreaterThan(
      worker.lastIndexOf('runPhase51RevenueOpsTick'),
    );
    expect(lib).toMatch(/webhookUrl/);
    expect(lib).toMatch(/ops_alerts/);
    expect(lib).toMatch(/record_marketing_pending_proposals_digest_phase52/);
    expect(lib).toMatch(/never_auto_approves_money/);
  });

  it('never logs or stores secret values in phase52 surfaces', () => {
    const lib = readFileSync(
      new URL('./marketing-phase52.ts', import.meta.url),
      'utf8',
    );
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase52_marketing_revenue_ops.sql',
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
