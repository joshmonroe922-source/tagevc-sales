import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/phase42_intune_recommendation_soak.sql',
    import.meta.url,
  ),
  'utf8',
);
const phase41 = readFileSync(
  new URL(
    '../../../supabase/phase41_intune_outage_postmortems.sql',
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

describe('Phase 42 Intune recommendation soak', () => {
  it('records append-only aggregate soak observations after accepted drafts', () => {
    expect(migration).toContain('os_it_intune_recommendation_soak_observations');
    expect(migration).toContain('observe_it_intune_recommendation_soak_phase42');
    expect(migration).toContain('get_it_intune_phase42_ops_report');
    expect(migration).toContain("d.status='accepted'");
    expect(migration).toContain("'entity_identifiers_included',false");
    expect(migration).toContain(
      "not (aggregate_evidence ? 'entity_id')",
    );
    expect(migration).toContain('public.os_sha256_hex');
    expect(migration).toContain('Phase 42 Intune soak evidence is append-only');
    expect(migration).toContain('closes_or_resets_breaker=false');
  });

  it('never closes or resets open breakers during soak', () => {
    expect(migration).toContain("'breaker_open_observed'");
    expect(migration).toContain(
      'Soak observations never update breaker rows and never call reset/close RPCs',
    );
    expect(migration).toContain("'closes_or_resets_breaker',false");
    expect(migration).not.toContain('propose_it_intune_breaker_reset');
    expect(migration).not.toContain(
      "update public.os_it_intune_provider_breakers",
    );
    expect(migration).not.toContain("state='closed'");
    expect(migration).not.toContain(
      'create or replace function public.accept_it_intune_threshold_recommendation',
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

  it('wires soak observe tick after Phase 41 follow-ups', () => {
    expect(worker).toContain("'generate_it_intune_phase41_followups'");
    expect(worker).toContain(
      "'observe_it_intune_recommendation_soak_phase42'",
    );
    expect(worker.indexOf("'generate_it_intune_phase41_followups'")).toBeLessThan(
      worker.indexOf("'observe_it_intune_recommendation_soak_phase42'"),
    );
    expect(worker).toContain('processIntunePhase42Soak');
    expect(worker).not.toContain('propose_it_intune_breaker_reset');
  });

  it('exposes repo/actions/UI soak status on accepted recommendations', () => {
    expect(repo).toContain('os_it_intune_recommendation_soak_status');
    expect(repo).toContain('getIntunePhase42Health');
    expect(repo).toContain('observeIntuneRecommendationSoak');
    expect(actions).toContain('refreshIntuneRecommendationSoakAction');
    expect(client).toContain('soak_status');
    expect(client).toContain('Refresh recommendation soak');
    expect(client).toContain('never auto-reset');
  });

  it('preserves Phase 41 rails and does not rebuild postmortems or accept', () => {
    expect(phase41).toContain('os_it_intune_threshold_recommendation_drafts');
    expect(phase41).toContain('accept_it_intune_threshold_recommendation');
    expect(migration).not.toContain(
      'create or replace function public.seed_it_intune_outage_postmortem',
    );
    expect(migration).not.toContain(
      'create or replace function public.generate_it_intune_threshold_recommendation',
    );
    expect(migration).not.toContain(
      'create or replace function public.propose_it_intune_breaker_tuning',
    );
  });

  it('grants only service-role mutation RPCs and authenticated selects', () => {
    expect(migration).toContain('from public,authenticated,service_role');
    expect(migration).toContain('to service_role');
    expect(migration).toContain(
      'grant select on public.os_it_intune_recommendation_soak_status',
    );
    expect(migration).toContain('os_it_intune_phase42_health');
  });
});
