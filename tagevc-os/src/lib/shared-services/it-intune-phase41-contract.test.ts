import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/phase41_intune_outage_postmortems.sql',
    import.meta.url,
  ),
  'utf8',
);
const phase40 = readFileSync(
  new URL(
    '../../../supabase/phase40_intune_resilience_observability.sql',
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

describe('Phase 41 Intune outage postmortems and threshold drafts', () => {
  it('keeps postmortems aggregate-only with maker-checker publish', () => {
    expect(migration).toContain('os_it_intune_outage_postmortems');
    expect(migration).toContain('os_it_intune_outage_postmortem_events');
    expect(migration).toContain("'entity_identifiers_included',false");
    expect(migration).toContain(
      "not (aggregate_evidence ? 'entity_id')",
    );
    expect(migration).toContain('v_pm.drafted_by=p_actor_id');
    expect(migration).toContain('Independent postmortem publish denied');
    expect(migration).toContain('public.os_sha256_hex');
    expect(migration).toContain('Phase 41 Intune evidence is append-only');
  });

  it('drafts bounded recommendations that only create Phase 40 proposals', () => {
    expect(migration).toContain('os_it_intune_threshold_recommendation_drafts');
    expect(migration).toContain('recommended_failure_window_minutes between 5 and 120');
    expect(migration).toContain('recommended_minimum_samples between 3 and 50');
    expect(migration).toContain(
      'recommended_failure_rate_threshold between 0.2500 and 0.9500',
    );
    expect(migration).toContain('public.propose_it_intune_breaker_tuning(');
    expect(migration).toContain(
      'Recommendation cannot close, reset, or modify an open breaker',
    );
    expect(migration).toContain("'closes_or_resets_breaker',false");
    expect(migration).not.toContain('propose_it_intune_breaker_reset');
    expect(migration).not.toContain(
      "state='closed' where breaker_id=v_reco.breaker_id",
    );
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

  it('wires worker follow-ups after outage correlation', () => {
    expect(worker).toContain("'generate_it_intune_phase41_followups'");
    expect(worker.indexOf("'correlate_it_intune_provider_outage'")).toBeLessThan(
      worker.indexOf("'generate_it_intune_phase41_followups'"),
    );
    expect(worker).toContain('processIntunePhase41Followups');
    expect(worker).not.toContain('propose_it_intune_breaker_reset');
  });

  it('exposes repo/actions/UI for postmortems and recommendation review', () => {
    expect(repo).toContain('listIntuneOutagePostmortems');
    expect(repo).toContain('listIntuneThresholdRecommendations');
    expect(repo).toContain('acceptIntuneThresholdRecommendation');
    expect(repo).toContain('publishIntuneOutagePostmortem');
    expect(client).toContain('system recommendation');
    expect(client).toContain('Accept → tuning proposal');
    expect(client).toContain('cannot accept until closed');
  });

  it('preserves Phase 40 tuning and does not rebuild dispatch authorization', () => {
    expect(phase40).toContain('propose_it_intune_breaker_tuning');
    expect(phase40).toContain(
      'Tuning cannot close, reset, or modify an open breaker',
    );
    expect(migration).not.toContain(
      'create or replace function public.authorize_it_intune_dispatch_v4',
    );
    expect(migration).not.toContain(
      'create or replace function public.propose_it_intune_breaker_tuning',
    );
  });

  it('grants only service-role mutation RPCs and authenticated selects', () => {
    expect(migration).toContain('from public,authenticated,service_role');
    expect(migration).toContain('to service_role');
    expect(migration).toContain(
      'grant select on public.os_it_intune_outage_postmortem_status',
    );
    expect(migration).toContain('os_it_intune_phase41_health');
  });
});
