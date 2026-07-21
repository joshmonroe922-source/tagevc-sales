import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyIntuneProviderOutcome } from './it-intune-worker';

const migration = readFileSync(
  new URL(
    '../../../supabase/phase39_intune_provider_circuit_breaker.sql',
    import.meta.url,
  ),
  'utf8',
);
const worker = readFileSync(
  new URL('./it-intune-worker.ts', import.meta.url),
  'utf8',
);
const claimV4 = migration.slice(
  migration.indexOf('create or replace function public.claim_it_intune_action_v4'),
  migration.indexOf(
    'create or replace function public.authorize_it_intune_dispatch_v4',
  ),
);

describe('Phase 39 Intune provider circuit breaker', () => {
  it('classifies only provider-outage signals as read failures', () => {
    expect(classifyIntuneProviderOutcome(200, 'preflight_read')).toBe('success');
    expect(classifyIntuneProviderOutcome(404, 'verification_read')).toBe(
      'success',
    );
    expect(classifyIntuneProviderOutcome(401, 'verification_read')).toBe(
      'ignored',
    );
    expect(classifyIntuneProviderOutcome(400, 'preflight_read')).toBe('ignored');
    expect(classifyIntuneProviderOutcome(409, 'dispatch_post')).toBe('ignored');
    expect(classifyIntuneProviderOutcome(429, 'preflight_read')).toBe('failure');
    expect(classifyIntuneProviderOutcome(503, 'verification_read')).toBe(
      'failure',
    );
    expect(classifyIntuneProviderOutcome(503, 'dispatch_post')).toBe(
      'ambiguous',
    );
  });

  it('keeps deterministic sampling and entity-operation scope', () => {
    expect(migration).toContain(
      'unique index if not exists os_it_intune_provider_breaker_scope_uidx',
    );
    expect(migration).toContain(
      'order by observed_at desc,observation_id desc limit 20',
    );
    expect(migration).toContain("and outcome<>'ignored'");
    expect(migration).toContain('failure_rate_threshold numeric(5,4) not null default 0.5000');
    expect(migration).toContain("v_open_mode:='dispatch_post'");
    expect(migration).toContain("v_open_mode:='provider_read'");
    expect(migration).toContain('observation_key uuid not null');
    expect(migration).not.toContain('p_outcome text');
    expect(migration).toContain(
      "state text not null default 'closed'",
    );
    expect(migration).toContain(
      "check (state in ('closed','open','half_open'))",
    );
  });

  it('fences one canary and preserves verification recovery', () => {
    expect(migration).toContain(
      "raise exception 'Intune provider circuit is open; POST authorization blocked'",
    );
    expect(migration).toContain(
      "raise exception 'Intune provider circuit already has a fenced canary'",
    );
    expect(migration).toContain('Intune canary lease/token mismatch');
    expect(migration).toContain(
      'Canary close requires preflight, POST, and independent verification observations',
    );
    expect(migration).toContain("'canary_post_accepted'");
    expect(migration).toContain("'canary_recovered'");
    expect(migration).toContain(
      'recover_stale_it_intune_breaker_canaries',
    );
    expect(worker).toContain(
      "'recover_stale_it_intune_breaker_canaries'",
    );
    expect(migration).toContain(
      "a.status not in ('approved','preflighting')",
    );
    expect(claimV4).not.toContain("state,'closed'");
    expect(claimV4).toContain("'approved','preflighting'");
    expect(migration).not.toContain(
      "'submitted','verifying','manual_review'",
    );
  });

  it('routes the only Intune retire POST through v4 authorization', () => {
    expect(worker.match(/managedDevices\/.*\/retire/g)).toHaveLength(1);
    expect(worker).toContain("'authorize_it_intune_dispatch_v4'");
    expect(worker).not.toContain("sb.rpc('authorize_it_intune_dispatch_v3'");
    expect(worker.indexOf("'authorize_it_intune_dispatch_v4'")).toBeLessThan(
      worker.indexOf("method: 'POST'", worker.indexOf('/retire')),
    );
  });

  it('requires independent governed reset and append-only evidence', () => {
    expect(migration).toContain('v_proposal.proposed_by=p_actor_id');
    expect(migration).toContain(
      'Insufficient durable read-only recovery observations',
    );
    expect(migration).toContain('Intune breaker events are append-only');
    expect(migration).toContain(
      'Independent review requires fresh post-proposal recovery evidence',
    );
    expect(migration).toContain(
      'before truncate on public.os_it_intune_provider_observations',
    );
    expect(migration).toContain(
      'from public,authenticated,service_role',
    );
    expect(migration).toMatch(
      /grant execute on function[\s\S]*public\.propose_it_intune_breaker_reset\([\s\S]*to service_role/,
    );
    expect(migration).toContain('to service_role');
  });
});
