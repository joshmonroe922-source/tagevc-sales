import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/phase44_intune_resilience_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const phase43 = readFileSync(
  new URL(
    '../../../supabase/phase43_intune_soak_cycle_evidence.sql',
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

describe('Phase 44 Intune resilience ops', () => {
  it('records observe-only performance snapshots, alerts, and correlation', () => {
    expect(migration).toContain(
      'os_it_intune_breaker_config_performance_snapshots',
    );
    expect(migration).toContain('os_it_intune_phase44_ops_alerts');
    expect(migration).toContain('os_it_intune_resilience_correlation_timeline');
    expect(migration).toContain('os_it_intune_phase44_health');
    expect(migration).toContain('snapshot_it_intune_breaker_performance_phase44');
    expect(migration).toContain('list_it_intune_phase44_critical_windows');
    expect(migration).toContain('record_it_intune_phase44_ops_alert');
    expect(migration).toContain('get_it_intune_phase44_ops_report');
    expect(migration).toContain('correlate_it_intune_resilience_phase44');
    expect(migration).toContain('it_intune_phase44_sanitize_aggregate');
    expect(migration).toContain('public.os_sha256_hex');
    expect(migration).toContain("'entity_identifiers_included',false");
    expect(migration).toContain('window_key text not null unique');
    expect(migration).toContain("'read_only_canary_unhealthy'");
    expect(migration).toContain("'canary_stale'");
    expect(migration).toContain("'canary_during_outage'");
    expect(migration).toContain("'open_awaiting_close_aged'");
    expect(migration).toContain("'breaker_failure_rate_elevated'");
    expect(migration).toContain(
      'Phase 44 Intune resilience ops evidence is append-only',
    );
    expect(migration).toContain("'closes_or_resets_breaker',false");
  });

  it('never closes or resets open breakers and never touches os_store_snapshots', () => {
    expect(migration).toContain(
      'Performance snapshots never update breaker rows and never call reset/close RPCs',
    );
    expect(migration).toContain(
      'Correlation is observe-only and never updates breaker rows or reset/close RPCs',
    );
    expect(migration).toContain("'closes_or_resets_breaker',false");
    expect(migration).not.toContain('propose_it_intune_breaker_reset');
    expect(migration).not.toContain(
      'update public.os_it_intune_provider_breakers',
    );
    expect(migration).not.toContain('os_store_snapshots');
    expect(migration).not.toContain(
      'create or replace function public.accept_it_intune_threshold_recommendation',
    );
    expect(migration).not.toContain(
      'create or replace function public.seed_it_intune_outage_postmortem',
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

  it('wires resilience ops tick after Phase 43 cycle evidence', () => {
    expect(worker).toContain(
      "'record_it_intune_soak_cycle_evidence_phase43'",
    );
    expect(worker).toContain(
      "'snapshot_it_intune_breaker_performance_phase44'",
    );
    expect(worker).toContain("'correlate_it_intune_resilience_phase44'");
    expect(worker).toContain("'list_it_intune_phase44_critical_windows'");
    expect(worker).toContain("'record_it_intune_phase44_ops_alert'");
    expect(worker).toContain('processIntunePhase44ResilienceOps');
    expect(
      worker.indexOf("'record_it_intune_soak_cycle_evidence_phase43'"),
    ).toBeLessThan(
      worker.indexOf("'snapshot_it_intune_breaker_performance_phase44'"),
    );
    expect(
      worker.indexOf("'snapshot_it_intune_breaker_performance_phase44'"),
    ).toBeLessThan(worker.indexOf("'correlate_it_intune_resilience_phase44'"));
    expect(
      worker.indexOf("'correlate_it_intune_resilience_phase44'"),
    ).toBeLessThan(
      worker.indexOf("'list_it_intune_phase44_critical_windows'"),
    );
    expect(
      worker.indexOf("'list_it_intune_phase44_critical_windows'"),
    ).toBeLessThan(worker.indexOf("'record_it_intune_phase44_ops_alert'"));
    expect(worker).not.toContain('propose_it_intune_breaker_reset');
    expect(worker).toContain('webhookUrl');
    expect(worker).toContain('ops_alerts');
  });

  it('exposes repo/actions/UI correlation timeline and Phase 44 badges', () => {
    expect(repo).toContain('os_it_intune_resilience_correlation_timeline');
    expect(repo).toContain('os_it_intune_phase44_health');
    expect(repo).toContain('getIntunePhase44Health');
    expect(repo).toContain('listIntuneResilienceCorrelationTimeline');
    expect(repo).toContain('getIntunePhase44OpsReport');
    expect(repo).toContain('runIntunePhase44ResilienceOps');
    expect(actions).toContain('refreshIntunePhase44ResilienceOpsAction');
    expect(client).toContain('Resilience correlation timeline');
    expect(client).toContain('intuneResilienceCorrelation');
    expect(client).toContain('intunePhase44Health');
    expect(client).toContain('refreshIntunePhase44ResilienceOpsAction');
    expect(page).toContain('getIntunePhase44Health');
    expect(page).toContain('listIntuneResilienceCorrelationTimeline');
    expect(page).toContain('Phase 44');
  });

  it('preserves Phase 43 soak cycle rails', () => {
    expect(phase43).toContain('os_it_intune_soak_cycle_evidence');
    expect(phase43).toContain('record_it_intune_soak_cycle_evidence_phase43');
    expect(migration).toContain('os_it_intune_soak_cycle_evidence');
    expect(migration).not.toContain(
      'create table if not exists public.os_it_intune_soak_cycle_evidence',
    );
  });

  it('grants service-role mutation RPCs and authenticated selects', () => {
    expect(migration).toContain('from public,authenticated,service_role');
    expect(migration).toContain('to service_role');
    expect(migration).toContain(
      'grant select on public.os_it_intune_resilience_correlation_timeline',
    );
    expect(migration).toContain('os_it_intune_phase44_health');
    expect(migration).toContain(
      'revoke all on function public.snapshot_it_intune_breaker_performance_phase44()',
    );
    expect(migration).toContain(
      'revoke all on function public.record_it_intune_phase44_ops_alert(jsonb)',
    );
  });
});
