import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/phase45_intune_resilience_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const phase44 = readFileSync(
  new URL(
    '../../../supabase/phase44_intune_resilience_ops.sql',
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

describe('Phase 45 Intune resilience quality gates', () => {
  it('records postmortem quality reviews, promote gates, and ops alerts', () => {
    expect(migration).toContain('os_it_intune_postmortem_quality_reviews');
    expect(migration).toContain('os_it_intune_tuning_promote_gates');
    expect(migration).toContain('os_it_intune_phase45_ops_alerts');
    expect(migration).toContain('os_it_intune_phase45_health');
    expect(migration).toContain('it_intune_phase45_sanitize_aggregate');
    expect(migration).toContain(
      'review_it_intune_postmortem_quality_phase45',
    );
    expect(migration).toContain(
      'evaluate_it_intune_tuning_promote_gate_phase45',
    );
    expect(migration).toContain(
      'accept_it_intune_threshold_recommendation_phase45',
    );
    expect(migration).toContain('get_it_intune_phase45_ops_report');
    expect(migration).toContain('list_it_intune_phase45_critical_windows');
    expect(migration).toContain('record_it_intune_phase45_ops_alert');
    expect(migration).toContain("'postmortem_quality_low'");
    expect(migration).toContain("'tuning_promote_blocked'");
    expect(migration).toContain("'multi_cycle_trend_degraded'");
    expect(migration).toContain("'blocked'");
    expect(migration).toContain("'ready'");
    expect(migration).toContain("'waived'");
    expect(migration).toContain('window_key text not null unique');
    expect(migration).toContain("'entity_identifiers_included',false");
    expect(migration).toContain(
      'Phase 45 Intune resilience quality gate evidence is append-only',
    );
    expect(migration).toContain('it_intune_phase45_min_cycle_count');
  });

  it('never closes or resets open breakers and never touches os_store_snapshots', () => {
    expect(migration).toContain(
      'Quality reviews never update breaker rows and never call reset/close RPCs',
    );
    expect(migration).toContain(
      'Promote gates never update breaker rows and never call reset/close RPCs',
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
      'accept_it_intune_threshold_recommendation_phase45',
    );
    expect(migration).toContain(
      'public.accept_it_intune_threshold_recommendation(',
    );
    if (migration.includes('closes_or_resets_breaker')) {
      expect(migration).toMatch(/closes_or_resets_breaker['"]?\s*,\s*false/);
    }
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

  it('wires quality gate tick after Phase 44 resilience ops', () => {
    expect(worker).toContain(
      "'snapshot_it_intune_breaker_performance_phase44'",
    );
    expect(worker).toContain(
      "'review_it_intune_postmortem_quality_phase45'",
    );
    expect(worker).toContain(
      "'evaluate_it_intune_tuning_promote_gate_phase45'",
    );
    expect(worker).toContain("'list_it_intune_phase45_critical_windows'");
    expect(worker).toContain("'record_it_intune_phase45_ops_alert'");
    expect(worker).toContain('processIntunePhase45QualityGateOps');
    expect(
      worker.indexOf("'snapshot_it_intune_breaker_performance_phase44'"),
    ).toBeLessThan(
      worker.indexOf("'review_it_intune_postmortem_quality_phase45'"),
    );
    expect(
      worker.indexOf("'review_it_intune_postmortem_quality_phase45'"),
    ).toBeLessThan(
      worker.indexOf("'evaluate_it_intune_tuning_promote_gate_phase45'"),
    );
    expect(
      worker.indexOf("'evaluate_it_intune_tuning_promote_gate_phase45'"),
    ).toBeLessThan(
      worker.indexOf("'list_it_intune_phase45_critical_windows'"),
    );
    expect(
      worker.indexOf("'list_it_intune_phase45_critical_windows'"),
    ).toBeLessThan(worker.indexOf("'record_it_intune_phase45_ops_alert'"));
    expect(worker).not.toContain('propose_it_intune_breaker_reset');
  });

  it('exposes repo/actions/UI quality and promote gate badges', () => {
    expect(repo).toContain('os_it_intune_phase45_health');
    expect(repo).toContain('os_it_intune_postmortem_quality_status');
    expect(repo).toContain('os_it_intune_tuning_promote_gate_status');
    expect(repo).toContain('getIntunePhase45Health');
    expect(repo).toContain('listIntunePostmortemQualityStatus');
    expect(repo).toContain('listIntuneTuningPromoteGateStatus');
    expect(repo).toContain('getIntunePhase45OpsReport');
    expect(repo).toContain('runIntunePhase45QualityGateOps');
    expect(repo).toContain(
      'accept_it_intune_threshold_recommendation_phase45',
    );
    expect(actions).toContain('evaluateIntuneTuningPromoteGate');
    expect(actions).toContain('getIntuneTuningPromoteGate');
    expect(actions).toContain('refreshIntunePhase45QualityGateOpsAction');
    expect(actions).toContain('Phase 45 promote gate blocked');
    expect(client).toContain('intunePhase45Health');
    expect(client).toContain('intunePostmortemQuality');
    expect(client).toContain('intunePromoteGates');
    expect(client).toContain('refreshIntunePhase45QualityGateOpsAction');
    expect(client).toContain('promote gate');
    expect(client).toContain('quality ');
    expect(client).toContain('Accept → tuning proposal');
    expect(page).toContain('getIntunePhase45Health');
    expect(page).toContain('listIntunePostmortemQualityStatus');
    expect(page).toContain('listIntuneTuningPromoteGateStatus');
  });

  it('preserves Phase 44 resilience rails', () => {
    expect(phase44).toContain(
      'os_it_intune_breaker_config_performance_snapshots',
    );
    expect(phase44).toContain('snapshot_it_intune_breaker_performance_phase44');
    expect(migration).toContain(
      'os_it_intune_breaker_config_performance_snapshots',
    );
    expect(migration).not.toContain(
      'create table if not exists public.os_it_intune_breaker_config_performance_snapshots',
    );
  });

  it('grants service-role mutation RPCs and authenticated selects', () => {
    expect(migration).toContain('from public,authenticated,service_role');
    expect(migration).toContain('to service_role');
    expect(migration).toContain(
      'grant select on public.os_it_intune_phase45_health',
    );
    expect(migration).toContain(
      'revoke all on function public.review_it_intune_postmortem_quality_phase45()',
    );
    expect(migration).toContain(
      'revoke all on function public.record_it_intune_phase45_ops_alert(jsonb)',
    );
  });
});
