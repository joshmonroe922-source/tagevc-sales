import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_PHASE51_REPORT_VERSION,
  emptyArchivePhase51OpsReport,
} from './archive-phase51';

const sql = readFileSync(
  new URL(
    '../../../supabase/phase51_docusign_archive_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const phase50 = readFileSync(
  new URL(
    '../../../supabase/phase50_docusign_archive_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const lib = readFileSync(
  new URL('./archive-phase51.ts', import.meta.url),
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

describe('Phase 51 DocuSign firm-wide cadence rollups + third-approver escalation', () => {
  it('shapes the phase51 ops report contract and empty helper', () => {
    const empty = emptyArchivePhase51OpsReport();
    expect(empty.version).toBe(ARCHIVE_PHASE51_REPORT_VERSION);
    expect(empty.cadence_rollup_overall_trend).toBe('unknown');
    expect(empty.cadence_rollup_snapshots_compared).toBe(0);
    expect(empty.cadence_rollup_min_on_time_rate).toBeNull();
    expect(empty.cadence_rollup_max_on_time_rate).toBeNull();
    expect(empty.cadence_rollup_avg_on_time_rate).toBeNull();
    expect(empty.pending_budget_proposals).toEqual([]);
    expect(empty.pending_third_approver_escalatable_count).toBe(0);
    expect(empty.third_approver_escalations_7d).toBe(0);
    expect(empty.alerts).toEqual([]);
    expect(empty.destination_key).toBe('ops_alerts');
    expect(empty.never_creates_voids_or_resends_envelopes).toBe(true);
    expect(empty.never_auto_activates).toBe(true);
  });

  it('is rerunnable and bootstraps Phase 50 helpers without rebuilding prior rails', () => {
    expect((sql.split('$$').length - 1) % 2).toBe(0);
    expect(sql).toContain('phase50_docusign_archive_ops.sql');
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_phase51_cadence_rollups',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_third_approver_escalations',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_phase51_ops_alerts',
    );
    expect(sql).not.toContain(
      'create table if not exists public.os_docusign_archive_cadence_trend_snapshots',
    );
    expect(phase50).toContain(
      'create table if not exists public.os_docusign_archive_cadence_trend_snapshots',
    );
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

  it('records firm-wide cadence rollups and third-approver escalations without ever approving/activating', () => {
    expect(sql).toContain('record_docusign_cadence_rollup_phase51');
    expect(sql).toContain('list_docusign_archive_phase51_critical_windows');
    expect(sql).toContain('record_docusign_third_approver_escalation_phase51');
    expect(sql).toContain('record_docusign_archive_phase51_ops_alert');
    expect(sql).toContain('get_docusign_archive_phase51_ops_report');
    expect(sql).toContain('phase51_docusign_ops_safe_metadata');
    expect(sql).toContain('phase50_docusign_ops_safe_metadata');
    expect(sql).not.toMatch(
      /\bcall\b[\s\S]{0,40}approve_docusign_budget_revision_proposal_phase49|:=\s*public\.approve_docusign_budget_revision_proposal_phase49/,
    );
    expect(sql).toContain('never_activates');
    expect(sql).toContain('never_auto_activates');
    expect(sql).toContain('cadence_rollup_declining');
    expect(sql).toContain('third_approver_escalation_raised');
    expect(sql).toContain(
      'Phase 51 DocuSign archive ops evidence is append-only',
    );
    expect(sql).toMatch(
      /grant execute on function public\.get_docusign_archive_phase51_ops_report\(\)[\s\S]*authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_docusign_cadence_rollup_phase51\([\s\S]*to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_docusign_third_approver_escalation_phase51\([\s\S]*to service_role/,
    );
  });

  it('firm-wide cadence rollup computes streaks/min/max/avg across multiple Phase 50 snapshots', () => {
    expect(sql).toMatch(/snapshots_compared/);
    expect(sql).toMatch(/improving_streak/);
    expect(sql).toMatch(/declining_streak/);
    expect(sql).toMatch(/min_on_time_rate/);
    expect(sql).toMatch(/max_on_time_rate/);
    expect(sql).toMatch(/avg_on_time_rate/);
    expect(sql).toMatch(
      /from public\.os_docusign_archive_cadence_trend_snapshots/,
    );
  });

  it('third-approver escalation only fires when still 1 distinct approver AND reminder unanswered past threshold', () => {
    expect(sql).toMatch(
      /count\(distinct a\.actor_id\) filter \(where a\.decision='approve'\) = 1/,
    );
    expect(sql).toMatch(
      /min\(r\.created_at\) <= now\(\) - make_interval\(days => v_threshold_days\)/,
    );
    expect(sql).toMatch(/os_docusign_archive_second_approver_reminders/);
  });

  it('keeps evidence metadata-only and never creates/voids/resends envelopes', () => {
    expect(sql).toContain('Never create/void/resend envelopes');
    expect(sql).toContain('Never mutates snapshot retirement tables');
    expect(sql).not.toMatch(/os_store_snapshots/);
    expect(sql).not.toMatch(
      /content_base64|pdf_content|certificate_content|raw_payload/,
    );
    expect(lib).not.toMatch(
      /createEnvelopeFromTemplate|dispatchPreparedDocuSignSend|sendEnvelope|voidEnvelope/,
    );
    expect(lib).toContain('getArchivePhase51OpsReport');
    expect(lib).toContain('runArchivePhase51OpsTick');
    expect(lib).toContain('webhookUrl');
    expect(lib).toContain('ops_alerts');
    expect(lib).toContain('never_activates');
  });

  it('wires worker tick after Phase 50 and hub Phase 51 badges', () => {
    expect(route).toContain('runArchivePhase51OpsTick');
    expect(route).toContain('runArchivePhase50OpsTick');
    expect(route).toContain('phase51_ops_ok');
    expect(route.lastIndexOf('runArchivePhase51OpsTick')).toBeGreaterThan(
      route.lastIndexOf('runArchivePhase50OpsTick'),
    );
    expect(page).toContain('getArchivePhase51OpsReport');
    expect(page).toContain('Phase 51');
    expect(page).toContain(
      'phase51Ops.report.cadence_rollup_overall_trend',
    );
    expect(page).toContain('phase51CadenceRollupTrend');
    expect(hub).toContain('Phase 51 cadence rollup');
    expect(hub).toContain('phase51CadenceRollupTrend');
    expect(hub).toContain('phase51PendingEscalatableCount');
    expect(page).toContain('getArchivePhase52OpsReport');
    expect(page).toContain('Phase 52');
    expect(hub).toContain('Phase 52');
    expect(hub).toContain('phase52PendingFourthCount');
    expect(hub).toContain('phase52ChainThresholdDays');
  });
});
