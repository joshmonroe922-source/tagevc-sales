import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/phase40_intune_resilience_observability.sql',
    import.meta.url,
  ),
  'utf8',
);
const phase39 = readFileSync(
  new URL(
    '../../../supabase/phase39_intune_provider_circuit_breaker.sql',
    import.meta.url,
  ),
  'utf8',
);
const phase38 = readFileSync(
  new URL('../../../supabase/phase38_intune_ambiguity_governance.sql', import.meta.url),
  'utf8',
);
const worker = readFileSync(
  new URL('./it-intune-worker.ts', import.meta.url),
  'utf8',
);

describe('Phase 40 Intune resilience and observability', () => {
  it('keeps tuning versioned, bounded, immutable, and maker-checker', () => {
    expect(migration).toContain('os_it_intune_breaker_config_versions');
    expect(migration).toContain('os_it_intune_breaker_tuning_proposals');
    expect(migration).toContain('os_it_intune_breaker_tuning_decisions');
    expect(migration).toContain("risk_class in ('standard','riskier')");
    expect(migration).toContain('p_minimum_samples not between 3 and 50');
    expect(migration).toContain('v_proposal.proposed_by=p_actor_id');
    expect(migration).toContain(
      'Tuning cannot close, reset, or modify an open breaker',
    );
    expect(migration).toContain(
      'Phase 40 Intune evidence is append-only',
    );
    expect(migration).toContain('before truncate on public.%I');
  });

  it('correlates scopes without persisting entity identifiers', () => {
    expect(migration).toContain('count(distinct b.entity_scope)');
    expect(migration).toContain("'entity_identifiers_included',false");
    expect(migration).toContain('os_it_intune_outage_episode_events');
    expect(migration).toContain(
      "event_type in ('detected','evidence_updated','recovering','resolved')",
    );
    expect(migration).toContain('public.is_firm_wide_access()');
  });

  it('keeps health canary GET-only and distinct from dispatch canary', () => {
    const healthCanary = worker.slice(
      worker.indexOf('async function runReadOnlyHealthCanaryWithToken'),
      worker.indexOf('export async function processReadOnlyIntuneHealthCanary'),
    );
    expect(healthCanary).toContain("method: 'GET'");
    expect(healthCanary).not.toContain("method: 'POST'");
    expect(healthCanary).not.toContain('authorize_it_intune_dispatch_v4');
    expect(migration).toContain("'half_open_canary',false");
    expect(migration).toContain("'dispatch_authorized',false");
    expect(migration).toContain('os_it_intune_one_active_health_canary');
    expect(migration).toContain('Health canary lease/version fence rejected');
    expect(migration).toContain('attempt_no between 0 and 3');
  });

  it('deduplicates incidents and exposes recovery/SLO state', () => {
    expect(migration).toContain('dedupe_key text not null unique');
    expect(migration).toContain("on conflict (dedupe_key) do update");
    expect(migration).toContain('os_it_intune_phase40_health');
    expect(migration).toContain("then 'breached'");
    expect(migration).toContain("then 'warning'");
  });

  it('preserves Phase 39 dispatch and Phase 38 tombstone controls', () => {
    expect(migration).not.toContain(
      'create or replace function public.authorize_it_intune_dispatch_v4',
    );
    expect(migration).not.toContain(
      'create or replace function public.finish_it_intune_action_v4',
    );
    expect(phase39).toContain(
      'Intune provider circuit is open; POST authorization blocked',
    );
    expect(phase38).toContain(
      'A dispatched Intune tombstone blocks new root actions',
    );
    expect(worker.match(/managedDevices\/.*\/retire/g)).toHaveLength(1);
  });

  it('allows only service-role mutation RPCs', () => {
    expect(migration).toContain('from public,authenticated,service_role');
    expect(migration).toContain('to service_role');
    expect(migration).toContain(
      'public.it_intune_manual_review_actor_allowed',
    );
  });
});
