import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/phase47_intune_resilience_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const phase46 = readFileSync(
  new URL(
    '../../../supabase/phase46_intune_resilience_ops.sql',
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

describe('Phase 47 Intune waive expiry dual-approve + MTTR correlation', () => {
  it('records expiry proposals/decisions, MTTR correlations, and ops alerts', () => {
    expect(migration).toContain(
      'os_it_intune_promote_waive_expiry_proposals',
    );
    expect(migration).toContain(
      'os_it_intune_promote_waive_expiry_decisions',
    );
    expect(migration).toContain('os_it_intune_scorecard_mttr_correlations');
    expect(migration).toContain('os_it_intune_phase47_ops_alerts');
    expect(migration).toContain('os_it_intune_phase47_health');
    expect(migration).toContain("'extend'");
    expect(migration).toContain("'expire'");
    expect(migration).toContain('cycle_elapsed_minutes');
    expect(migration).toContain('correlation_delta');
    expect(migration).toContain('composite_score');
    expect(migration).toContain(
      'propose_it_intune_promote_waive_expiry_phase47',
    );
    expect(migration).toContain(
      'review_it_intune_promote_waive_expiry_phase47',
    );
    expect(migration).toContain(
      'correlate_it_intune_scorecard_mttr_phase47',
    );
    expect(migration).toContain(
      'accept_it_intune_threshold_recommendation_phase47',
    );
    expect(migration).toContain('get_it_intune_phase47_ops_report');
    expect(migration).toContain('list_it_intune_phase47_critical_windows');
    expect(migration).toContain('record_it_intune_phase47_ops_alert');
    expect(migration).toContain("'waive_expiry_pending'");
    expect(migration).toContain("'mttr_score_mismatch'");
    expect(migration).toContain("'waive_expired'");
    expect(migration).toContain("'proposed'");
    expect(migration).toContain("'approved'");
    expect(migration).toContain("'rejected'");
    expect(migration).toContain(
      'decided_by must differ from proposed_by',
    );
    expect(migration).toContain('window_key text not null unique');
    expect(migration).toContain("'entity_identifiers_included',false");
  });

  it('never closes or resets open breakers and never touches os_store_snapshots', () => {
    expect(migration).toContain(
      'MTTR correlations never update breaker rows and never call reset/close RPCs',
    );
    expect(migration).toContain(
      'Expiry proposals never update breaker rows and never call reset/close RPCs',
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
      'accept_it_intune_threshold_recommendation_phase47',
    );
    expect(migration).toContain(
      'public.accept_it_intune_threshold_recommendation_phase46(',
    );
    if (migration.includes('closes_or_resets_breaker')) {
      expect(migration).toMatch(/closes_or_resets_breaker['"]?\s*,\s*false/);
    }
  });

  it('blocks expired waives unless dual-approved expiry-extend renews TTL', () => {
    expect(migration).toContain(
      'expire_it_intune_promote_waive_approved_phase47',
    );
    expect(migration).toContain(
      'get_it_intune_active_promote_waive_phase47',
    );
    expect(migration).toContain(
      'Phase 47 waived promote expired — dual-approved expiry-extend required',
    );
    expect(migration).toContain('needs_dual_approved_extend');
    expect(migration).toContain('expiry_extended');
    expect(migration).toContain(
      "v_proposal.proposed_by=p_actor_id",
    );
    expect(migration).toContain("action='extend'");
    expect(migration).toContain("action='expire'");
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

  it('wires correlate + expiry tick + alerts after Phase 46', () => {
    expect(worker).toContain(
      "'score_it_intune_postmortem_quality_phase46'",
    );
    expect(worker).toContain(
      "'correlate_it_intune_scorecard_mttr_phase47'",
    );
    expect(worker).toContain(
      "'expire_it_intune_promote_waive_approved_phase47'",
    );
    expect(worker).toContain("'list_it_intune_phase47_critical_windows'");
    expect(worker).toContain("'record_it_intune_phase47_ops_alert'");
    expect(worker).toContain('processIntunePhase47ExpiryMttrOps');
    expect(
      worker.indexOf("'score_it_intune_postmortem_quality_phase46'"),
    ).toBeLessThan(
      worker.indexOf("'correlate_it_intune_scorecard_mttr_phase47'"),
    );
    expect(
      worker.indexOf("'correlate_it_intune_scorecard_mttr_phase47'"),
    ).toBeLessThan(
      worker.indexOf("'expire_it_intune_promote_waive_approved_phase47'"),
    );
    expect(
      worker.indexOf("'expire_it_intune_promote_waive_approved_phase47'"),
    ).toBeLessThan(
      worker.indexOf("'list_it_intune_phase47_critical_windows'"),
    );
    expect(
      worker.indexOf("'list_it_intune_phase47_critical_windows'"),
    ).toBeLessThan(worker.indexOf("'record_it_intune_phase47_ops_alert'"));
    expect(worker).not.toContain('propose_it_intune_breaker_reset');
  });

  it('exposes repo/actions/UI expiry CTAs and MTTR correlation badges', () => {
    expect(repo).toContain('os_it_intune_phase47_health');
    expect(repo).toContain(
      'os_it_intune_scorecard_mttr_correlation_status',
    );
    expect(repo).toContain('os_it_intune_promote_waive_expiry_status');
    expect(repo).toContain('getIntunePhase47Health');
    expect(repo).toContain('listIntuneScorecardMttrCorrelations');
    expect(repo).toContain('listIntunePromoteWaiveExpiryStatus');
    expect(repo).toContain('getIntunePhase47OpsReport');
    expect(repo).toContain('runIntunePhase47ExpiryMttrOps');
    expect(repo).toContain('proposeIntunePromoteWaiveExpiry');
    expect(repo).toContain('reviewIntunePromoteWaiveExpiry');
    expect(repo).toContain(
      'accept_it_intune_threshold_recommendation_phase47',
    );
    expect(actions).toContain('proposeIntunePromoteWaiveExpiryAction');
    expect(actions).toContain('reviewIntunePromoteWaiveExpiryAction');
    expect(actions).toContain('refreshIntunePhase47ExpiryMttrOpsAction');
    expect(actions).toContain('Phase 47 promote gate blocked');
    expect(actions).toContain('dual-approved expiry-extend');
    expect(client).toContain('intunePhase47Health');
    expect(client).toContain('intunePromoteWaiveExpiries');
    expect(client).toContain('intuneScorecardMttrCorrelations');
    expect(client).toContain('Propose extend');
    expect(client).toContain('Propose expire');
    expect(client).toContain('Dual-approve');
    expect(client).toContain('refreshIntunePhase47ExpiryMttrOpsAction');
    expect(client).toContain('MTTR');
    expect(client).toContain('correlation_delta');
    expect(page).toContain('getIntunePhase47Health');
    expect(page).toContain('listIntuneScorecardMttrCorrelations');
    expect(page).toContain('listIntunePromoteWaiveExpiryStatus');
  });

  it('preserves Phase 46 waive and scorecard rails', () => {
    expect(phase46).toContain('os_it_intune_promote_waive_proposals');
    expect(phase46).toContain('os_it_intune_postmortem_quality_scorecards');
    expect(phase46).toContain(
      'accept_it_intune_threshold_recommendation_phase46',
    );
    expect(migration).toContain(
      'get_it_intune_active_promote_waive_phase46',
    );
    expect(migration).not.toContain(
      'create table if not exists public.os_it_intune_promote_waive_proposals',
    );
    expect(migration).not.toContain(
      'create table if not exists public.os_it_intune_postmortem_quality_scorecards',
    );
  });

  it('grants service-role mutation RPCs and authenticated selects', () => {
    expect(migration).toContain('from public,authenticated,service_role');
    expect(migration).toContain('to service_role');
    expect(migration).toContain(
      'grant select on public.os_it_intune_phase47_health',
    );
    expect(migration).toContain(
      'revoke all on function public.correlate_it_intune_scorecard_mttr_phase47()',
    );
    expect(migration).toContain(
      'revoke all on function public.record_it_intune_phase47_ops_alert(jsonb)',
    );
    expect(migration).toContain(
      'public.propose_it_intune_promote_waive_expiry_phase47(uuid,uuid,text,text,timestamptz,bigint)',
    );
    expect(migration).toContain('to service_role');
    expect(migration).toContain('to authenticated');
  });
});
