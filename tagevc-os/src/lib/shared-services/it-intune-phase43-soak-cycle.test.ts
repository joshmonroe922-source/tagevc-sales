import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/phase43_intune_soak_cycle_evidence.sql',
    import.meta.url,
  ),
  'utf8',
);
const phase42 = readFileSync(
  new URL(
    '../../../supabase/phase42_intune_recommendation_soak.sql',
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

describe('Phase 43 Intune soak cycle evidence', () => {
  it('records append-only open→closed cycle evidence after Phase 42 open observations', () => {
    expect(migration).toContain('os_it_intune_soak_cycle_evidence');
    expect(migration).toContain('record_it_intune_soak_cycle_evidence_phase43');
    expect(migration).toContain('get_it_intune_phase43_ops_report');
    expect(migration).toContain("'breaker_closed_observed'");
    expect(migration).toContain("'cycle_complete'");
    expect(migration).toContain("o.soak_status='breaker_open_observed'");
    expect(migration).toContain("v_breaker.state<>'closed'");
    expect(migration).toContain("pm.status as postmortem_status");
    expect(migration).toContain("'entity_identifiers_included',false");
    expect(migration).toContain('public.os_sha256_hex');
    expect(migration).toContain(
      'Phase 43 Intune soak cycle evidence is append-only',
    );
    expect(migration).toContain('closes_or_resets_breaker = false');
    expect(migration).toContain("'closes_or_resets_breaker',false");
  });

  it('never closes or resets open breakers during cycle evidence recording', () => {
    expect(migration).toContain(
      'Cycle evidence never updates breaker rows and never calls reset/close RPCs',
    );
    expect(migration).toContain("'closes_or_resets_breaker',false");
    expect(migration).not.toContain('propose_it_intune_breaker_reset');
    expect(migration).not.toContain(
      'update public.os_it_intune_provider_breakers',
    );
    expect(migration).not.toContain("state='closed'");
    expect(migration).not.toContain(
      'create or replace function public.accept_it_intune_threshold_recommendation',
    );
    expect(migration).not.toContain(
      'create or replace function public.seed_it_intune_outage_postmortem',
    );
    expect(migration).not.toContain(
      'create or replace function public.generate_it_intune_threshold_recommendation',
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

  it('wires cycle evidence tick after Phase 42 soak observe', () => {
    expect(worker).toContain(
      "'observe_it_intune_recommendation_soak_phase42'",
    );
    expect(worker).toContain(
      "'record_it_intune_soak_cycle_evidence_phase43'",
    );
    expect(
      worker.indexOf("'observe_it_intune_recommendation_soak_phase42'"),
    ).toBeLessThan(
      worker.indexOf("'record_it_intune_soak_cycle_evidence_phase43'"),
    );
    expect(worker).toContain('processIntunePhase43SoakCycle');
    expect(worker).not.toContain('propose_it_intune_breaker_reset');
  });

  it('exposes repo/actions/UI soak cycle timeline', () => {
    expect(repo).toContain('os_it_intune_soak_cycle_timeline');
    expect(repo).toContain('getIntunePhase43Health');
    expect(repo).toContain('listIntuneSoakCycleTimeline');
    expect(repo).toContain('recordIntuneSoakCycleEvidence');
    expect(actions).toContain('recordIntuneSoakCycleEvidence');
    expect(actions).toContain('open→closed cycle');
    expect(client).toContain('Soak open→closed cycle timeline');
    expect(client).toContain('intuneSoakCycleTimeline');
    expect(client).toContain('soak_cycle_status');
    expect(client).toContain('never auto-reset');
    expect(page).toContain('getIntunePhase43Health');
    expect(page).toContain('listIntuneSoakCycleTimeline');
  });

  it('preserves Phase 42 soak rails and does not rebuild postmortems', () => {
    expect(phase42).toContain('os_it_intune_recommendation_soak_observations');
    expect(phase42).toContain('observe_it_intune_recommendation_soak_phase42');
    expect(migration).toContain(
      'os_it_intune_recommendation_soak_observations',
    );
    expect(migration).toContain('os_it_intune_reco_soak_status_check');
    expect(migration).not.toContain(
      'create table if not exists public.os_it_intune_recommendation_soak_observations',
    );
  });

  it('grants only service-role mutation RPCs and authenticated selects', () => {
    expect(migration).toContain('from public,authenticated,service_role');
    expect(migration).toContain('to service_role');
    expect(migration).toContain(
      'grant select on public.os_it_intune_soak_cycle_timeline',
    );
    expect(migration).toContain('os_it_intune_phase43_health');
    expect(migration).toContain(
      'revoke all on function public.record_it_intune_soak_cycle_evidence_phase43()',
    );
  });
});
