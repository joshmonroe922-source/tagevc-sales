import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/phase48_intune_resilience_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const phase47 = readFileSync(
  new URL(
    '../../../supabase/phase47_intune_resilience_ops.sql',
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

describe('Phase 48 Intune template suggestions + waive lifecycle paging', () => {
  it('records template suggestions, lifecycle snapshots, and ops alerts', () => {
    expect(migration).toContain(
      'os_it_intune_postmortem_template_suggestions',
    );
    expect(migration).toContain('os_it_intune_waive_lifecycle_snapshots');
    expect(migration).toContain('os_it_intune_phase48_ops_alerts');
    expect(migration).toContain('os_it_intune_phase48_health');
    expect(migration).toContain('suggested_fields');
    expect(migration).toContain('mttr_minutes');
    expect(migration).toContain('composite_score');
    expect(migration).toContain('correlation_id');
    expect(migration).toContain('proposed_count');
    expect(migration).toContain('approved_count');
    expect(migration).toContain('expired_count');
    expect(migration).toContain('extended_count');
    expect(migration).toContain(
      'suggest_it_intune_postmortem_template_phase48',
    );
    expect(migration).toContain(
      'record_it_intune_waive_lifecycle_snapshot_phase48',
    );
    expect(migration).toContain('list_it_intune_phase48_critical_windows');
    expect(migration).toContain('record_it_intune_phase48_ops_alert');
    expect(migration).toContain('get_it_intune_phase48_ops_report');
    expect(migration).toContain("'waive_expired_page'");
    expect(migration).toContain("'template_suggestion_ready'");
    expect(migration).toContain("'lifecycle_anomaly'");
    expect(migration).toContain("'suggested'");
    expect(migration).toContain("'auto_publish',false");
    expect(migration).toContain('requires_human_publish');
    expect(migration).toContain('window_key text not null unique');
    expect(migration).toContain("'entity_identifiers_included',false");
  });

  it('never closes or resets open breakers and never touches os_store_snapshots', () => {
    expect(migration).toContain(
      'Template suggestions never update breaker rows and never call reset/close RPCs',
    );
    expect(migration).toContain(
      'Lifecycle snapshots never update breaker rows and never call reset/close RPCs',
    );
    expect(migration).toContain("'closes_or_resets_breaker',false");
    expect(migration).not.toContain('propose_it_intune_breaker_reset');
    expect(migration).not.toContain(
      'update public.os_it_intune_provider_breakers',
    );
    expect(migration).not.toContain('os_store_snapshots');
    expect(migration).not.toContain(
      'create or replace function public.publish_it_intune_outage_postmortem',
    );
    expect(migration).toContain('Never auto-publish postmortems');
    if (migration.includes('closes_or_resets_breaker')) {
      expect(migration).toMatch(/closes_or_resets_breaker['"]?\s*,\s*false/);
    }
  });

  it('pages expired waives without dual-approved extend', () => {
    expect(migration).toContain('waive_expired_page');
    expect(migration).toContain('waivepg:');
    expect(migration).toContain("action='extend'");
    expect(migration).toContain(
      'expire_it_intune_promote_waive_approved_phase47',
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

  it('wires suggest + lifecycle + alerts after Phase 47', () => {
    expect(worker).toContain(
      "'correlate_it_intune_scorecard_mttr_phase47'",
    );
    expect(worker).toContain(
      "'suggest_it_intune_postmortem_template_phase48'",
    );
    expect(worker).toContain(
      "'record_it_intune_waive_lifecycle_snapshot_phase48'",
    );
    expect(worker).toContain("'list_it_intune_phase48_critical_windows'");
    expect(worker).toContain("'record_it_intune_phase48_ops_alert'");
    expect(worker).toContain('processIntunePhase48TemplateLifecycleOps');
    expect(worker).toContain('waive_expired_page');
    expect(
      worker.indexOf("'correlate_it_intune_scorecard_mttr_phase47'"),
    ).toBeLessThan(
      worker.indexOf("'suggest_it_intune_postmortem_template_phase48'"),
    );
    expect(
      worker.indexOf("'suggest_it_intune_postmortem_template_phase48'"),
    ).toBeLessThan(
      worker.indexOf("'record_it_intune_waive_lifecycle_snapshot_phase48'"),
    );
    expect(
      worker.indexOf("'record_it_intune_waive_lifecycle_snapshot_phase48'"),
    ).toBeLessThan(
      worker.indexOf("'list_it_intune_phase48_critical_windows'"),
    );
    expect(
      worker.indexOf("'list_it_intune_phase48_critical_windows'"),
    ).toBeLessThan(worker.indexOf("'record_it_intune_phase48_ops_alert'"));
    expect(worker).not.toContain('propose_it_intune_breaker_reset');
  });

  it('exposes repo/actions/UI template and lifecycle surfaces', () => {
    expect(repo).toContain('os_it_intune_phase48_health');
    expect(repo).toContain(
      'os_it_intune_postmortem_template_suggestion_status',
    );
    expect(repo).toContain('os_it_intune_waive_lifecycle_status');
    expect(repo).toContain('getIntunePhase48Health');
    expect(repo).toContain('listIntunePostmortemTemplateSuggestions');
    expect(repo).toContain('getIntuneWaiveLifecycleStatus');
    expect(repo).toContain('getIntunePhase48OpsReport');
    expect(repo).toContain('runIntunePhase48TemplateLifecycleOps');
    expect(actions).toContain(
      'refreshIntunePhase48TemplateLifecycleOpsAction',
    );
    expect(actions).toContain('never auto-publish');
    expect(client).toContain('intunePhase48Health');
    expect(client).toContain('intunePostmortemTemplateSuggestions');
    expect(client).toContain('intuneWaiveLifecycle');
    expect(client).toContain('refreshIntunePhase48TemplateLifecycleOpsAction');
    expect(client).toContain('never auto-publish');
    expect(client).toContain('Waive lifecycle visibility');
    expect(client).toContain('SLO_WEBHOOK_OPS_ALERTS');
    expect(page).toContain('getIntunePhase48Health');
    expect(page).toContain('listIntunePostmortemTemplateSuggestions');
    expect(page).toContain('getIntuneWaiveLifecycleStatus');
  });

  it('preserves Phase 47 MTTR and waive expiry rails', () => {
    expect(phase47).toContain('os_it_intune_scorecard_mttr_correlations');
    expect(phase47).toContain(
      'os_it_intune_promote_waive_expiry_proposals',
    );
    expect(migration).toContain(
      'expire_it_intune_promote_waive_approved_phase47',
    );
    expect(migration).toContain(
      'it_intune_phase47_mttr_mismatch_threshold',
    );
    expect(migration).not.toContain(
      'create table if not exists public.os_it_intune_scorecard_mttr_correlations',
    );
    expect(migration).not.toContain(
      'create table if not exists public.os_it_intune_promote_waive_proposals',
    );
  });

  it('grants service-role mutation RPCs and authenticated selects', () => {
    expect(migration).toContain('from public,authenticated,service_role');
    expect(migration).toContain('to service_role');
    expect(migration).toContain(
      'grant select on public.os_it_intune_phase48_health',
    );
    expect(migration).toContain(
      'revoke all on function public.suggest_it_intune_postmortem_template_phase48()',
    );
    expect(migration).toContain(
      'revoke all on function public.record_it_intune_phase48_ops_alert(jsonb)',
    );
    expect(migration).toContain('to service_role');
    expect(migration).toContain('to authenticated');
  });
});
