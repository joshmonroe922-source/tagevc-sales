import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/phase46_intune_resilience_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const phase45 = readFileSync(
  new URL(
    '../../../supabase/phase45_intune_resilience_ops.sql',
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

describe('Phase 46 Intune dual-approver waive + deeper quality scoring', () => {
  it('records waive proposals/decisions, scorecards, and ops alerts', () => {
    expect(migration).toContain('os_it_intune_promote_waive_proposals');
    expect(migration).toContain('os_it_intune_promote_waive_decisions');
    expect(migration).toContain('os_it_intune_postmortem_quality_scorecards');
    expect(migration).toContain('os_it_intune_phase46_ops_alerts');
    expect(migration).toContain('os_it_intune_phase46_health');
    expect(migration).toContain('cycle_trend_component');
    expect(migration).toContain('correlation_coverage_component');
    expect(migration).toContain('root_cause_component');
    expect(migration).toContain('notes_quality_component');
    expect(migration).toContain('composite_score');
    expect(migration).toContain('propose_it_intune_promote_waive_phase46');
    expect(migration).toContain('review_it_intune_promote_waive_phase46');
    expect(migration).toContain('score_it_intune_postmortem_quality_phase46');
    expect(migration).toContain(
      'accept_it_intune_threshold_recommendation_phase46',
    );
    expect(migration).toContain('get_it_intune_phase46_ops_report');
    expect(migration).toContain('list_it_intune_phase46_critical_windows');
    expect(migration).toContain('record_it_intune_phase46_ops_alert');
    expect(migration).toContain("'waive_pending'");
    expect(migration).toContain("'quality_score_low'");
    expect(migration).toContain("'dual_approve_required'");
    expect(migration).toContain("'proposed'");
    expect(migration).toContain("'approved'");
    expect(migration).toContain("'rejected'");
    expect(migration).toContain("'expired'");
    expect(migration).toContain('decided_by must differ from proposed_by');
    expect(migration).toContain('window_key text not null unique');
    expect(migration).toContain("'entity_identifiers_included',false");
  });

  it('never closes or resets open breakers and never touches os_store_snapshots', () => {
    expect(migration).toContain(
      'Quality scorecards never update breaker rows and never call reset/close RPCs',
    );
    expect(migration).toContain(
      'Promote gates never update breaker rows and never call reset/close RPCs',
    );
    expect(migration).toContain(
      'Waive proposals never update breaker rows and never call reset/close RPCs',
    );
    expect(migration).toContain("'closes_or_resets_breaker',false");
    expect(migration).not.toContain('propose_it_intune_breaker_reset');
    expect(migration).not.toContain(
      'update public.os_it_intune_provider_breakers',
    );
    expect(migration).not.toContain('os_store_snapshots');
    expect(migration).not.toContain(
      'create or replace function public.accept_it_intune_threshold_recommendation(',
    );
    expect(migration).toContain(
      'accept_it_intune_threshold_recommendation_phase46',
    );
    expect(migration).toContain(
      'public.accept_it_intune_threshold_recommendation(',
    );
    if (migration.includes('closes_or_resets_breaker')) {
      expect(migration).toMatch(/closes_or_resets_breaker['"]?\s*,\s*false/);
    }
  });

  it('enforces dual-approver waive before waived promote accept', () => {
    expect(migration).toContain('enforce_it_intune_promote_waive_dual_actor');
    expect(migration).toContain(
      'get_it_intune_active_promote_waive_phase46',
    );
    expect(migration).toContain(
      'Phase 46 waived promote requires dual-approver audit',
    );
    expect(migration).toContain(
      'need ready scorecard or dual-approved waive',
    );
    expect(migration).toContain("v_proposal.proposed_by=p_actor_id");
    expect(migration).toContain("'waived'");
    expect(migration).toContain("'ready'");
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

  it('wires scorecard/waive tick after Phase 45 quality gates', () => {
    expect(worker).toContain(
      "'review_it_intune_postmortem_quality_phase45'",
    );
    expect(worker).toContain(
      "'score_it_intune_postmortem_quality_phase46'",
    );
    expect(worker).toContain(
      "'evaluate_it_intune_tuning_promote_gate_phase46'",
    );
    expect(worker).toContain("'list_it_intune_phase46_critical_windows'");
    expect(worker).toContain("'record_it_intune_phase46_ops_alert'");
    expect(worker).toContain('processIntunePhase46QualityWaiveOps');
    expect(
      worker.indexOf("'review_it_intune_postmortem_quality_phase45'"),
    ).toBeLessThan(
      worker.indexOf("'score_it_intune_postmortem_quality_phase46'"),
    );
    expect(
      worker.indexOf("'score_it_intune_postmortem_quality_phase46'"),
    ).toBeLessThan(
      worker.indexOf("'evaluate_it_intune_tuning_promote_gate_phase46'"),
    );
    expect(
      worker.indexOf("'evaluate_it_intune_tuning_promote_gate_phase46'"),
    ).toBeLessThan(
      worker.indexOf("'list_it_intune_phase46_critical_windows'"),
    );
    expect(
      worker.indexOf("'list_it_intune_phase46_critical_windows'"),
    ).toBeLessThan(worker.indexOf("'record_it_intune_phase46_ops_alert'"));
    expect(worker).not.toContain('propose_it_intune_breaker_reset');
  });

  it('exposes repo/actions/UI waive CTAs and deeper score badges', () => {
    expect(repo).toContain('os_it_intune_phase46_health');
    expect(repo).toContain('os_it_intune_postmortem_quality_scorecard_status');
    expect(repo).toContain('os_it_intune_promote_waive_status');
    expect(repo).toContain('getIntunePhase46Health');
    expect(repo).toContain('listIntunePostmortemQualityScorecards');
    expect(repo).toContain('listIntunePromoteWaiveStatus');
    expect(repo).toContain('getIntunePhase46OpsReport');
    expect(repo).toContain('runIntunePhase46QualityWaiveOps');
    expect(repo).toContain('proposeIntunePromoteWaive');
    expect(repo).toContain('reviewIntunePromoteWaive');
    expect(repo).toContain(
      'accept_it_intune_threshold_recommendation_phase47',
    );
    expect(actions).toContain('proposeIntunePromoteWaiveAction');
    expect(actions).toContain('reviewIntunePromoteWaiveAction');
    expect(actions).toContain('refreshIntunePhase46QualityWaiveOpsAction');
    expect(actions).toContain('Phase 47 promote gate blocked');
    expect(actions).toContain('dual-approved waive');
    expect(client).toContain('intunePhase46Health');
    expect(client).toContain('intunePostmortemScorecards');
    expect(client).toContain('intunePromoteWaives');
    expect(client).toContain('Propose waive');
    expect(client).toContain('Dual-approve waive');
    expect(client).toContain('refreshIntunePhase46QualityWaiveOpsAction');
    expect(client).toContain('cycle_trend_component');
    expect(client).toContain('correlation_coverage_component');
    expect(client).toContain('Accept → tuning proposal');
    expect(page).toContain('getIntunePhase46Health');
    expect(page).toContain('listIntunePostmortemQualityScorecards');
    expect(page).toContain('listIntunePromoteWaiveStatus');
  });

  it('preserves Phase 45 quality rails', () => {
    expect(phase45).toContain('os_it_intune_postmortem_quality_reviews');
    expect(phase45).toContain('os_it_intune_tuning_promote_gates');
    expect(phase45).toContain(
      'accept_it_intune_threshold_recommendation_phase45',
    );
    expect(migration).toContain(
      'evaluate_it_intune_tuning_promote_gate_phase45',
    );
    expect(migration).not.toContain(
      'create table if not exists public.os_it_intune_postmortem_quality_reviews',
    );
  });

  it('grants service-role mutation RPCs and authenticated selects', () => {
    expect(migration).toContain('from public,authenticated,service_role');
    expect(migration).toContain('to service_role');
    expect(migration).toContain(
      'grant select on public.os_it_intune_phase46_health',
    );
    expect(migration).toContain(
      'revoke all on function public.score_it_intune_postmortem_quality_phase46()',
    );
    expect(migration).toContain(
      'revoke all on function public.record_it_intune_phase46_ops_alert(jsonb)',
    );
    expect(migration).toContain(
      'public.propose_it_intune_promote_waive_phase46(uuid,uuid,text,bigint)',
    );
    expect(migration).toContain('to service_role');
    expect(migration).toContain('to authenticated');
  });
});
