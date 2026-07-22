import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/phase50_intune_resilience_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const phase49 = readFileSync(
  new URL(
    '../../../supabase/phase49_intune_resilience_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const worker = readFileSync(
  new URL('./it-intune-worker.ts', import.meta.url),
  'utf8',
);
const repo = readFileSync(
  new URL('./it-assets-repo.ts', import.meta.url),
  'utf8',
);
const client = readFileSync(
  new URL(
    '../../components/shared-services/it-assets-client.tsx',
    import.meta.url,
  ),
  'utf8',
);
const actions = readFileSync(
  new URL(
    '../../app/(app)/shared-services/it/assets/actions.ts',
    import.meta.url,
  ),
  'utf8',
);
const page = readFileSync(
  new URL(
    '../../app/(app)/shared-services/it/assets/page.tsx',
    import.meta.url,
  ),
  'utf8',
);

describe('Phase 50 Intune dual distinct-approver gate for breaker tuning + promote-waive', () => {
  it('records approvals, apply outcomes, and alerts for both tuning and waive', () => {
    expect(migration).toContain(
      'os_it_intune_breaker_tuning_phase50_approvals',
    );
    expect(migration).toContain(
      'os_it_intune_breaker_tuning_phase50_apply_events',
    );
    expect(migration).toContain(
      'os_it_intune_promote_waive_phase50_approvals',
    );
    expect(migration).toContain(
      'os_it_intune_promote_waive_phase50_apply_events',
    );
    expect(migration).toContain('os_it_intune_phase50_ops_alerts');
    expect(migration).toContain(
      'approve_it_intune_breaker_tuning_phase50',
    );
    expect(migration).toContain(
      'approve_it_intune_promote_waive_phase50',
    );
    expect(migration).toContain('list_it_intune_phase50_critical_windows');
    expect(migration).toContain('record_it_intune_phase50_ops_alert');
    expect(migration).toContain('get_it_intune_phase50_ops_report');
    expect(migration).toContain("'applied'");
    expect(migration).toContain("'awaiting_second_approval'");
    expect(migration).toContain("'blocked'");
    expect(migration).toContain("'recorded_reject'");
    expect(migration).toContain('window_key text not null unique');
    expect(migration).toContain("'entity_identifiers_included',false");
    expect(migration).toContain("'closes_or_resets_breaker',false");
  });

  it('never auto-applies and only calls the existing single-reviewer RPCs after 2 distinct approvals', () => {
    expect(migration).toContain(
      'v_review_result:=public.review_it_intune_breaker_tuning(',
    );
    expect(migration).toContain(
      'v_review_result:=public.review_it_intune_promote_waive_phase46(',
    );
    expect(migration).toContain('v_distinct < 2');
    expect(migration).toContain('count(distinct actor_id)');
    expect(migration).toContain('unique (proposal_id, actor_id)');
    expect(migration).toContain('unique (waive_proposal_id, actor_id)');
    expect(migration).toContain('NEVER auto-closes');
    expect(migration).not.toContain(
      'update public.os_it_intune_provider_breakers',
    );
    expect(migration).not.toContain('os_store_snapshots');
  });

  it('avoids bare CASE...THEN inside PL/pgSQL IF conditions', () => {
    const plpgsqlBlocks = migration.split(/language plpgsql/i).slice(1);
    for (const block of plpgsqlBlocks) {
      const body = block.slice(0, block.indexOf('$$;') + 3);
      expect(body).not.toMatch(
        /\bif\b[\s\S]{0,200}?\bcase\s+when\b[\s\S]{0,120}?\bthen\b/i,
      );
    }
  });

  it('wires dual-approve gate visibility alerts after Phase 49', () => {
    expect(worker).toContain("'list_it_intune_phase50_critical_windows'");
    expect(worker).toContain("'record_it_intune_phase50_ops_alert'");
    expect(worker).toContain('processIntunePhase50DualApproveGateOps');
    expect(
      worker.indexOf('runIntunePhase49PublishGateOpsTick'),
    ).toBeLessThan(
      worker.indexOf('runIntunePhase50DualApproveGateOpsTick'),
    );
    expect(worker).not.toContain('propose_it_intune_breaker_reset');
    expect(worker).not.toContain(
      "sb.from('os_it_intune_provider_breakers').update",
    );
  });

  it('exposes repo/actions/UI dual-approve surfaces requiring 2 distinct approvers', () => {
    expect(repo).toContain('getIntunePhase50OpsReport');
    expect(repo).toContain('runIntunePhase50DualApproveGateOps');
    expect(repo).toContain('approveIntuneBreakerTuningPhase50');
    expect(repo).toContain('approveIntunePromoteWaivePhase50');
    expect(actions).toContain('refreshIntunePhase50DualApproveGateOpsAction');
    expect(actions).toContain('approveIntuneBreakerTuningPhase50Action');
    expect(actions).toContain('approveIntunePromoteWaivePhase50Action');
    expect(actions).toContain('2 distinct approvers');
    expect(client).toContain('intunePhase50Ops');
    expect(client).toContain('approveIntuneBreakerTuningPhase50Action');
    expect(client).toContain('approveIntunePromoteWaivePhase50Action');
    expect(client).toContain('dual-approve');
    expect(page).toContain('getIntunePhase50OpsReport');
  });

  it('preserves Phase 49 human-apply/publish-gate rails without rebuilding them', () => {
    expect(phase49).toContain('os_it_intune_postmortem_apply_requests');
    expect(phase49).toContain('os_it_intune_postmortem_publish_approvals');
    expect(migration).not.toContain(
      'create table if not exists public.os_it_intune_postmortem_apply_requests',
    );
    expect(migration).not.toContain(
      'create table if not exists public.os_it_intune_postmortem_publish_approvals',
    );
  });

  it('never leaks entity identifiers in aggregate evidence', () => {
    expect(migration).toContain('os_it_intune_p50_tune_appr_no_entity_leak');
    expect(migration).toContain('os_it_intune_p50_waive_appr_no_entity_leak');
    expect(migration).toContain('os_it_intune_p50_alert_no_entity_leak');
    expect(migration).toContain("'entity_identifiers_included',false");
  });

  it('grants authenticated human dual-approve actions and service-role automation with append-only evidence', () => {
    expect(migration).toContain('from public,authenticated,service_role');
    expect(migration).toContain('to authenticated, service_role');
    expect(migration).toContain(
      'grant select on public.os_it_intune_breaker_tuning_phase50_approvals',
    );
    expect(migration).toContain(
      'Phase 50 Intune dual-approve gate evidence is append-only',
    );
    expect(migration).toContain('revoke insert,update,delete,truncate on');
  });
});
