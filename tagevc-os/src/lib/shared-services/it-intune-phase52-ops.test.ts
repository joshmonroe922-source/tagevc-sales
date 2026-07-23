import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/phase52_intune_resilience_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const phase51 = readFileSync(
  new URL(
    '../../../supabase/phase51_intune_resilience_ops.sql',
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

describe('Phase 52 Intune per-category backlog trends on Phase 51 inbox snapshots', () => {
  it('records per-category (postmortem/breaker/waive) trends from Phase 51 inbox snapshots', () => {
    expect(migration).toContain('record_it_intune_inbox_category_trends_phase52');
    expect(migration).toContain('os_it_intune_phase51_inbox_snapshots');
    expect(migration).toContain("category in ('postmortem','breaker','waive','total')");
    expect(migration).toContain('os_it_intune_phase52_category_trend_snapshots');
    expect(migration).toContain('get_it_intune_phase52_ops_report');
    expect(migration).toContain('postmortem_trend_direction');
    expect(migration).toContain('breaker_trend_direction');
    expect(migration).toContain('waive_trend_direction');
  });

  it('is observe-only: never applies, approves, closes, or resets anything', () => {
    expect(migration).toContain("'closes_or_resets_breaker',false");
    expect(migration).toContain("'requires_dual_approval',true");
    expect(migration).not.toContain(
      'update public.os_it_intune_provider_breakers',
    );
    expect(migration).not.toMatch(
      /:=\s*public\.review_it_intune_breaker_tuning\(/,
    );
    expect(migration).not.toMatch(
      /:=\s*public\.approve_it_intune_postmortem_publish\(/,
    );
    expect(migration).not.toContain('os_store_snapshots');
  });

  it('never leaks entity identifiers in category trend aggregates', () => {
    expect(migration).toContain('it_intune_phase52_sanitize_aggregate');
    expect(migration).toContain('os_it_intune_p52_trend_no_entity_leak');
    expect(migration).toContain('os_it_intune_p52_alert_no_entity_leak');
    expect(migration).toContain("'entity_identifiers_included',false");
    expect(migration).not.toMatch(/'entity_id',\s*[a-z_]+\.entity_id/);
  });

  it('records append-only category trends and aging/backlog alerts', () => {
    expect(migration).toContain('os_it_intune_phase52_ops_alerts');
    expect(migration).toContain('list_it_intune_phase52_critical_windows');
    expect(migration).toContain('record_it_intune_phase52_ops_alert');
    expect(migration).toContain('category_backlog_trend_declining');
    expect(migration).toContain('category_aging_critical');
    expect(migration).toContain(
      'Phase 52 Intune category backlog trend evidence is append-only',
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

  it('uses os_sha256_hex and set search_path = public, extensions for the hash helper', () => {
    expect(migration).toContain('public.os_sha256_hex');
    expect(migration).toContain('set search_path = public, extensions');
  });

  it('wires category trend ops after Phase 51 in the worker', () => {
    expect(worker).toContain("'record_it_intune_inbox_category_trends_phase52'");
    expect(worker).toContain("'list_it_intune_phase52_critical_windows'");
    expect(worker).toContain('processIntunePhase52CategoryTrendOps');
    expect(worker).toContain('runIntunePhase52CategoryTrendOpsTick');
    expect(
      worker.indexOf('runIntunePhase51UnifiedInboxOpsTick'),
    ).toBeLessThan(worker.indexOf('runIntunePhase52CategoryTrendOpsTick'));
  });

  it('exposes repo/actions/UI category trend surfaces', () => {
    expect(repo).toContain('getIntunePhase52OpsReport');
    expect(repo).toContain('runIntunePhase52CategoryTrendOps');
    expect(actions).toContain('refreshIntunePhase52CategoryTrendOpsAction');
    expect(client).toContain('intunePhase52Ops');
    expect(client).toContain('refreshIntunePhase52CategoryTrendOpsAction');
    expect(page).toContain('getIntunePhase52OpsReport');
    expect(page).toContain('Phase 52');
    expect(page).toContain('intunePhase52Ops');
  });

  it('preserves Phase 51 inbox rails without rebuilding them', () => {
    expect(phase51).toContain('os_it_intune_phase51_inbox_snapshots');
    expect(migration).not.toContain(
      'create table if not exists public.os_it_intune_phase51_inbox_snapshots',
    );
  });

  it('grants report execute to authenticated+service_role, mutation execute to service_role only', () => {
    expect(migration).toMatch(
      /public\.get_it_intune_phase52_ops_report\(\)\s*\n\s*to authenticated;/,
    );
    expect(migration).toMatch(
      /public\.record_it_intune_inbox_category_trends_phase52\(uuid\),\s*\n\s*public\.get_it_intune_phase52_ops_report\(\)\s*\n\s*to service_role/,
    );
    expect(migration).toContain('revoke insert,update,delete,truncate on');
  });
});
