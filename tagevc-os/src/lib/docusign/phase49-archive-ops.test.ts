import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_PHASE49_REPORT_VERSION,
  emptyArchivePhase49OpsReport,
} from './archive-phase49';

const sql = readFileSync(
  new URL(
    '../../../supabase/phase49_docusign_archive_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const phase48 = readFileSync(
  new URL(
    '../../../supabase/phase48_docusign_archive_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const lib = readFileSync(
  new URL('./archive-phase49.ts', import.meta.url),
  'utf8',
);
const route = readFileSync(
  new URL(
    '../../app/api/docusign/archive-governance-worker/route.ts',
    import.meta.url,
  ),
  'utf8',
);
const page = readFileSync(
  new URL('../../app/(app)/shared-services/legal/docusign/page.tsx', import.meta.url),
  'utf8',
);
const hub = readFileSync(
  new URL(
    '../../components/shared-services/docusign-hub-actions.tsx',
    import.meta.url,
  ),
  'utf8',
);

describe('Phase 49 DocuSign multi-quarter cadence SLO / budget revision proposals', () => {
  it('shapes the phase49 ops report contract and empty helper', () => {
    const empty = emptyArchivePhase49OpsReport();
    expect(empty.version).toBe(ARCHIVE_PHASE49_REPORT_VERSION);
    expect(empty.cadence_slo_severity).toBe('unknown');
    expect(empty.cadence_on_time_rate).toBeNull();
    expect(empty.cadence_breach).toBe(false);
    expect(empty.budget_proposal_status).toBe('none');
    expect(empty.pending_proposal_count).toBe(0);
    expect(empty.activated_proposal_count).toBe(0);
    expect(empty.recurring_run_status).toBe('none');
    expect(empty.drift_performance).toBe('unknown');
    expect(empty.alert_delivery).toBe('none');
    expect(empty.latest_cadence_slo).toBeNull();
    expect(empty.latest_budget_proposal).toBeNull();
    expect(empty.alerts).toEqual([]);
    expect(empty.destination_key).toBe('ops_alerts');
    expect(empty.never_creates_voids_or_resends_envelopes).toBe(true);
  });

  it('is rerunnable and bootstraps Phase 48 helpers without rebuilding prior rails', () => {
    expect((sql.split('$$').length - 1) % 2).toBe(0);
    expect(sql).toContain('phase48_docusign_archive_ops');
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_multi_quarter_cadence_slos',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_budget_revision_proposals',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_budget_revision_approvals',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_phase49_ops_alerts',
    );
    expect(sql).not.toContain(
      'create table if not exists public.os_docusign_archive_recurring_quarterly_runs',
    );
    expect(phase48).toContain('run_docusign_subsequent_recurring_quarterly_phase48');
    expect(sql).not.toContain('os_store_snapshots');
  });

  it('uses os_sha256_hex and avoids bare CASE inside IF conditions', () => {
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('set search_path = public, extensions');
    const withoutHelper = sql.replace(
      /create or replace function public\.os_sha256_hex[\s\S]*?\$\$;/,
      '',
    );
    expect(withoutHelper).not.toMatch(/encode\(digest\(/);
    expect(withoutHelper).not.toMatch(/\bdigest\s*\(/);
    const plpgsqlBodies = sql.split(/language plpgsql[\s\S]*?as \$\$/);
    for (const body of plpgsqlBodies.slice(1)) {
      const untilEnd = body.slice(0, body.indexOf('$$'));
      expect(untilEnd).not.toMatch(
        /\bif\b(?!\s+not\s+exists)[\s\S]{0,80}\bcase\s+when\b[\s\S]{0,60}\bthen\b/i,
      );
    }
  });

  it('records cadence SLO, proposes (never silently activates) budget revisions, and requires dual distinct approval', () => {
    expect(sql).toContain('record_docusign_multi_quarter_cadence_slo_phase49');
    expect(sql).toContain('propose_docusign_budget_revision_phase49');
    expect(sql).toContain('approve_docusign_budget_revision_proposal_phase49');
    expect(sql).toContain('list_docusign_archive_phase49_critical_windows');
    expect(sql).toContain('record_docusign_archive_phase49_ops_alert');
    expect(sql).toContain('get_docusign_archive_phase49_ops_report');
    expect(sql).toContain('phase49_docusign_ops_safe_metadata');
    expect(sql).toContain('phase48_docusign_ops_safe_metadata');
    expect(sql).toMatch(
      /status in\s*\(\s*'proposed','activated','rejected','blocked'\s*\)/,
    );
    expect(sql).toContain('distinct_actor_idx');
    expect(sql).toContain('count(distinct actor_id)');
    expect(sql).toContain('v_distinct_approvers < 2');
    expect(sql).toContain('awaiting_second_approval');
    expect(sql).toContain('window_key text not null unique');
    expect(sql).toContain('cadence_slo_breach');
    expect(sql).toContain('budget_revision_proposed');
    expect(sql).toContain('budget_revision_activated');
    expect(sql).toContain(
      'Phase 49 DocuSign archive ops evidence is append-only',
    );
    expect(sql).toMatch(
      /grant execute on function public\.get_docusign_archive_phase49_ops_report\(\)[\s\S]*authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.approve_docusign_budget_revision_proposal_phase49\([\s\S]*authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_docusign_multi_quarter_cadence_slo_phase49\([\s\S]*to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.propose_docusign_budget_revision_phase49\([\s\S]*to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_docusign_archive_phase49_ops_alert\(jsonb\)[\s\S]*to service_role/,
    );
  });

  it('keeps evidence metadata-only and never creates/voids/resends envelopes', () => {
    expect(sql).toContain('Never create/void/resend envelopes');
    expect(sql).toContain('Evidence = digests/metadata only');
    expect(sql).toContain('Never mutates snapshot retirement tables');
    expect(sql).not.toMatch(/os_store_snapshots/);
    expect(sql).not.toMatch(
      /content_base64|pdf_content|certificate_content|raw_payload/,
    );
    expect(lib).not.toMatch(
      /createEnvelopeFromTemplate|dispatchPreparedDocuSignSend|sendEnvelope|voidEnvelope/,
    );
    expect(lib).toContain('getArchivePhase49OpsReport');
    expect(lib).toContain('runArchivePhase49OpsTick');
    expect(lib).toContain('approveDocusignBudgetRevisionProposalPhase49');
    expect(lib).toContain('webhookUrl');
    expect(lib).toContain('ops_alerts');
    expect(lib).toContain('NEVER silently activates');
  });

  it('wires worker tick after Phase 48 and hub Phase 49 badges', () => {
    expect(route).toContain('runArchivePhase49OpsTick');
    expect(route).toContain('runArchivePhase48OpsTick');
    expect(route).toContain('phase49_ops_ok');
    expect(route.lastIndexOf('runArchivePhase49OpsTick')).toBeGreaterThan(
      route.lastIndexOf('runArchivePhase48OpsTick'),
    );
    expect(page).toContain('getArchivePhase49OpsReport');
    expect(page).toContain('Phase 49');
    expect(page).toContain('phase49Ops.report.cadence_slo_severity');
    expect(page).toContain('phase49CadenceSloSeverity');
    expect(hub).toContain('Phase 49 cadence');
    expect(hub).toContain('Phase 49 budget proposal');
    expect(hub).toContain('phase49CadenceSloSeverity');
    expect(hub).toContain('phase49BudgetProposalStatus');
  });
});
