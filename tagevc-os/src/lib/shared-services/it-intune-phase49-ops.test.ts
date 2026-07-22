import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/phase49_intune_resilience_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const phase48 = readFileSync(
  new URL(
    '../../../supabase/phase48_intune_resilience_ops.sql',
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

describe('Phase 49 Intune human-apply + dual-approve publish gate', () => {
  it('records apply requests, publish approvals, publish events, and alerts', () => {
    expect(migration).toContain('os_it_intune_postmortem_apply_requests');
    expect(migration).toContain('os_it_intune_postmortem_publish_approvals');
    expect(migration).toContain('os_it_intune_postmortem_publish_events');
    expect(migration).toContain('os_it_intune_phase49_ops_alerts');
    expect(migration).toContain(
      'request_it_intune_postmortem_apply_phase49',
    );
    expect(migration).toContain(
      'approve_it_intune_postmortem_publish_phase49',
    );
    expect(migration).toContain('list_it_intune_phase49_critical_windows');
    expect(migration).toContain('record_it_intune_phase49_ops_alert');
    expect(migration).toContain('get_it_intune_phase49_ops_report');
    expect(migration).toContain("'applied'");
    expect(migration).toContain("'awaiting_second_approval'");
    expect(migration).toContain("'published'");
    expect(migration).toContain("'blocked'");
    expect(migration).toContain("'recorded_reject'");
    expect(migration).toContain('window_key text not null unique');
    expect(migration).toContain("'entity_identifiers_included',false");
    expect(migration).toContain("'auto_publish',false");
  });

  it('never auto-publishes and only calls the existing maker-checker RPC after 2 distinct approvals', () => {
    expect(migration).toContain(
      'v_publish_result:=public.publish_it_intune_outage_postmortem(',
    );
    expect(migration).toContain('v_distinct < 2');
    expect(migration).toContain('count(distinct actor_id)');
    expect(migration).toContain('os_it_intune_p49_pub_appr_unique');
    expect(migration).toContain(
      'unique (postmortem_id, actor_id)',
    );
    expect(migration).toContain(
      'NEVER auto-publish',
    );
    expect(migration).not.toContain('propose_it_intune_breaker_reset');
    expect(migration).not.toContain(
      'update public.os_it_intune_provider_breakers',
    );
    expect(migration).not.toContain('os_store_snapshots');
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

  it('wires apply/publish-gate ops alerts after Phase 48', () => {
    expect(worker).toContain(
      "'suggest_it_intune_postmortem_template_phase48'",
    );
    expect(worker).toContain("'list_it_intune_phase49_critical_windows'");
    expect(worker).toContain("'record_it_intune_phase49_ops_alert'");
    expect(worker).toContain('processIntunePhase49PublishGateOps');
    expect(
      worker.indexOf("'record_it_intune_waive_lifecycle_snapshot_phase48'"),
    ).toBeLessThan(
      worker.indexOf("'list_it_intune_phase49_critical_windows'"),
    );
    expect(worker).not.toContain('propose_it_intune_breaker_reset');
  });

  it('exposes repo/actions/UI apply and dual-approve surfaces', () => {
    expect(repo).toContain('getIntunePhase49OpsReport');
    expect(repo).toContain('runIntunePhase49PublishGateOps');
    expect(actions).toContain('requestIntunePostmortemApplyAction');
    expect(actions).toContain('approveIntunePostmortemPublishAction');
    expect(actions).toContain('never auto-publish');
    expect(client).toContain('intunePhase49');
    expect(client).toContain('requestIntunePostmortemApplyAction');
    expect(client).toContain('approveIntunePostmortemPublishAction');
    expect(client).toContain('never auto-publish');
    expect(page).toContain('getIntunePhase49OpsReport');
  });

  it('preserves Phase 48 template suggestion and lifecycle rails', () => {
    expect(phase48).toContain(
      'os_it_intune_postmortem_template_suggestions',
    );
    expect(phase48).toContain('os_it_intune_waive_lifecycle_snapshots');
    expect(migration).not.toContain(
      'create table if not exists public.os_it_intune_postmortem_template_suggestions',
    );
    expect(migration).not.toContain(
      'create table if not exists public.os_it_intune_waive_lifecycle_snapshots',
    );
  });

  it('grants authenticated human actions and service-role automation with append-only evidence', () => {
    expect(migration).toContain('from public,authenticated,service_role');
    expect(migration).toContain('to authenticated, service_role');
    expect(migration).toContain(
      'grant select on public.os_it_intune_postmortem_apply_requests',
    );
    expect(migration).toContain(
      'Phase 49 Intune apply/publish-gate evidence is append-only',
    );
    expect(migration).toContain(
      'revoke insert,update,delete,truncate on',
    );
  });
});
