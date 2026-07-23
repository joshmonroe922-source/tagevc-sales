import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/phase51_intune_resilience_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const phase50 = readFileSync(
  new URL(
    '../../../supabase/phase50_intune_resilience_ops.sql',
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

describe('Phase 51 Intune unified dual-approve inbox (postmortem + breaker tuning + waive)', () => {
  it('unifies pending first/second approvals from all three Phase 49/50 rails', () => {
    expect(migration).toContain('list_it_intune_dual_approve_inbox_phase51');
    expect(migration).toContain('os_it_intune_postmortem_publish_events');
    expect(migration).toContain(
      'os_it_intune_breaker_tuning_phase50_apply_events',
    );
    expect(migration).toContain(
      'os_it_intune_promote_waive_phase50_apply_events',
    );
    expect(migration).toContain("disposition = 'awaiting_second_approval'");
    expect(migration).toContain("'kind','postmortem_publish'");
    expect(migration).toContain("'kind','breaker_tuning'");
    expect(migration).toContain("'kind','promote_waive'");
    expect(migration).toContain('postmortem_pending_count');
    expect(migration).toContain('breaker_tuning_pending_count');
    expect(migration).toContain('promote_waive_pending_count');
    expect(migration).toContain('total_pending_count');
  });

  it('is observe-only: never applies, approves, closes, or resets anything', () => {
    expect(migration).toContain("'closes_or_resets_breaker',false");
    expect(migration).toContain('os_it_intune_p51_inbox_no_auto_close');
    expect(migration).not.toContain(
      'update public.os_it_intune_provider_breakers',
    );
    expect(migration).not.toMatch(
      /:=\s*public\.review_it_intune_breaker_tuning\(/,
    );
    expect(migration).not.toMatch(
      /:=\s*public\.review_it_intune_promote_waive_phase46\(/,
    );
    expect(migration).not.toMatch(
      /:=\s*public\.approve_it_intune_postmortem_publish\(/,
    );
    expect(migration).not.toContain('os_store_snapshots');
  });

  it('never leaks entity identifiers in unified inbox aggregates', () => {
    expect(migration).toContain('it_intune_phase51_sanitize_aggregate');
    expect(migration).toContain('os_it_intune_p51_inbox_no_entity_leak');
    expect(migration).toContain('os_it_intune_p51_alert_no_entity_leak');
    expect(migration).toContain("'entity_identifiers_included',false");
    expect(migration).not.toMatch(/'entity_id',\s*[a-z_]+\.entity_id/);
  });

  it('records append-only inbox snapshots and backlog/stale alerts', () => {
    expect(migration).toContain('os_it_intune_phase51_inbox_snapshots');
    expect(migration).toContain('os_it_intune_phase51_ops_alerts');
    expect(migration).toContain('record_it_intune_phase51_inbox_snapshot');
    expect(migration).toContain('list_it_intune_phase51_critical_windows');
    expect(migration).toContain('record_it_intune_phase51_ops_alert');
    expect(migration).toContain('get_it_intune_phase51_ops_report');
    expect(migration).toContain('dual_approve_inbox_backlog_critical');
    expect(migration).toContain('dual_approve_inbox_stale_item');
    expect(migration).toContain(
      'Phase 51 Intune dual-approve inbox evidence is append-only',
    );
    expect(migration).toContain('window_key text not null unique');
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

  it('wires unified inbox ops after Phase 50 in the worker', () => {
    expect(worker).toContain("'record_it_intune_phase51_inbox_snapshot'");
    expect(worker).toContain("'list_it_intune_phase51_critical_windows'");
    expect(worker).toContain('processIntunePhase51UnifiedInboxOps');
    expect(worker).toContain('runIntunePhase51UnifiedInboxOpsTick');
    expect(
      worker.indexOf('runIntunePhase50DualApproveGateOpsTick'),
    ).toBeLessThan(worker.indexOf('runIntunePhase51UnifiedInboxOpsTick'));
    expect(worker).not.toContain('propose_it_intune_breaker_reset');
    expect(worker).not.toContain(
      "sb.from('os_it_intune_provider_breakers').update",
    );
  });

  it('exposes repo/actions/UI unified inbox surfaces', () => {
    expect(repo).toContain('getIntunePhase51OpsReport');
    expect(repo).toContain('listIntunePhase51DualApproveInbox');
    expect(repo).toContain('runIntunePhase51UnifiedInboxOps');
    expect(actions).toContain('refreshIntunePhase51UnifiedInboxOpsAction');
    expect(actions).toContain('observe-only');
    expect(client).toContain('intunePhase51Ops');
    expect(client).toContain('refreshIntunePhase51UnifiedInboxOpsAction');
    expect(client).toContain('Unified dual-approve inbox');
    expect(page).toContain('getIntunePhase51OpsReport');
    expect(page).toContain('Phase 51');
    expect(page).toContain('intunePhase51Ops');
  });

  it('preserves Phase 50 dual-approve rails without rebuilding them', () => {
    expect(phase50).toContain(
      'os_it_intune_breaker_tuning_phase50_apply_events',
    );
    expect(phase50).toContain(
      'os_it_intune_promote_waive_phase50_apply_events',
    );
    expect(migration).not.toContain(
      'create table if not exists public.os_it_intune_breaker_tuning_phase50_apply_events',
    );
    expect(migration).not.toContain(
      'create table if not exists public.os_it_intune_promote_waive_phase50_apply_events',
    );
  });

  it('grants report execute to authenticated+service_role, mutation execute to service_role only', () => {
    expect(migration).toMatch(
      /grant execute on function public\.list_it_intune_dual_approve_inbox_phase51\(integer\)\s*\n\s*to authenticated, service_role/,
    );
    expect(migration).toMatch(
      /public\.get_it_intune_phase51_ops_report\(\)\s*\n\s*to authenticated;/,
    );
    expect(migration).toMatch(
      /public\.record_it_intune_phase51_inbox_snapshot\(uuid\),\s*\n\s*public\.get_it_intune_phase51_ops_report\(\)\s*\n\s*to service_role/,
    );
    expect(migration).toContain('revoke insert,update,delete,truncate on');
    expect(migration).toContain(
      'Phase 51 Intune dual-approve inbox evidence is append-only',
    );
  });
});
