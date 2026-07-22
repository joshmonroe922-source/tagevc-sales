import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_PHASE48_REPORT_VERSION,
  emptyArchivePhase48OpsReport,
} from './archive-phase48';

const sql = readFileSync(
  new URL(
    '../../../supabase/phase48_docusign_archive_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const phase47 = readFileSync(
  new URL(
    '../../../supabase/phase47_docusign_archive_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const lib = readFileSync(
  new URL('./archive-phase48.ts', import.meta.url),
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

describe('Phase 48 DocuSign archive subsequent recurring / drift ops', () => {
  it('shapes the phase48 ops report contract and empty helper', () => {
    const empty = emptyArchivePhase48OpsReport();
    expect(empty.version).toBe(ARCHIVE_PHASE48_REPORT_VERSION);
    expect(empty.schedule_status).toBe('none');
    expect(empty.subsequent_run_status).toBe('none');
    expect(empty.drift_performance).toBe('unknown');
    expect(empty.breach_tighten_status).toBe('none');
    expect(empty.alert_delivery).toBe('none');
    expect(empty.completed_subsequent_count).toBe(0);
    expect(empty.breach_count_30d).toBe(0);
    expect(empty.recurring_quarterly_armed).toBe(false);
    expect(empty.latest_schedule).toBeNull();
    expect(empty.latest_subsequent_run).toBeNull();
    expect(empty.alerts).toEqual([]);
    expect(empty.destination_key).toBe('ops_alerts');
  });

  it('is rerunnable and bootstraps Phase 47 helpers without rebuilding prior rails', () => {
    expect((sql.split('$$').length - 1) % 2).toBe(0);
    expect(sql).toContain('phase47_docusign_archive_ops');
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_recurring_quarterly_runs',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_recurring_quarterly_reports',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_phase47_ops_alerts',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_recurring_quarterly_schedules',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_subsequent_quarterly_runs',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_drift_breach_tighten_events',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_recurring_performance_reports',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_phase48_ops_alerts',
    );
    expect(sql).not.toContain(
      'create table if not exists public.os_docusign_archive_drift_budgets',
    );
    expect(sql).not.toContain(
      'create table if not exists public.os_docusign_archive_drift_snapshots',
    );
    expect(phase47).toContain('run_docusign_first_armed_recurring_quarterly_phase47');
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

  it('records schedules, subsequent runs, breach tighten, reports, and alerts with grants', () => {
    expect(sql).toContain('schedule_docusign_subsequent_recurring_quarterly_phase48');
    expect(sql).toContain('run_docusign_subsequent_recurring_quarterly_phase48');
    expect(sql).toContain('tighten_docusign_drift_budget_on_breach_phase48');
    expect(sql).toContain('record_docusign_recurring_performance_report_phase48');
    expect(sql).toContain('list_docusign_archive_phase48_critical_windows');
    expect(sql).toContain('record_docusign_archive_phase48_ops_alert');
    expect(sql).toContain('get_docusign_archive_phase48_ops_report');
    expect(sql).toContain('phase48_docusign_ops_safe_metadata');
    expect(sql).toContain('phase47_docusign_ops_safe_metadata');
    expect(sql).toContain('open_docusign_archive_campaign');
    expect(sql).toContain('quarterly_full_integrity');
    expect(sql).toContain("status in ('started','completed','blocked','drift_budget_breach')");
    expect(sql).toContain('within_budget');
    expect(sql).toContain('max_content_drift_per_window');
    expect(sql).toContain('drift_performance');
    expect(sql).toContain('breach_tighten_status');
    expect(sql).toContain('window_key text not null unique');
    expect(sql).toContain('subsequent_run_blocked');
    expect(sql).toContain('drift_budget_breach');
    expect(sql).toContain('drift_budget_tightened_on_breach');
    expect(sql).toContain('subsequent_run_completed');
    expect(sql).toContain('schedule_due');
    expect(sql).toContain('performance_report_ready');
    expect(sql).toContain(
      'Phase 48 DocuSign archive ops evidence is append-only',
    );
    expect(sql).toMatch(
      /grant execute on function public\.get_docusign_archive_phase48_ops_report\(\)[\s\S]*authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.list_docusign_archive_phase48_critical_windows\(integer\)[\s\S]*authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.schedule_docusign_subsequent_recurring_quarterly_phase48\([\s\S]*to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.run_docusign_subsequent_recurring_quarterly_phase48\([\s\S]*to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.tighten_docusign_drift_budget_on_breach_phase48\([\s\S]*to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_docusign_recurring_performance_report_phase48\(jsonb\)[\s\S]*to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_docusign_archive_phase48_ops_alert\(jsonb\)[\s\S]*to service_role/,
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
    expect(lib).toContain('getArchivePhase48OpsReport');
    expect(lib).toContain('runArchivePhase48OpsTick');
    expect(lib).toContain('webhookUrl');
    expect(lib).toContain('ops_alerts');
  });

  it('wires worker tick after Phase 47 and hub Phase 48 badges', () => {
    expect(route).toContain('runArchivePhase48OpsTick');
    expect(route).toContain('runArchivePhase47OpsTick');
    expect(route).toContain('phase48_ops_ok');
    expect(route.lastIndexOf('runArchivePhase48OpsTick')).toBeGreaterThan(
      route.lastIndexOf('runArchivePhase47OpsTick'),
    );
    expect(page).toContain('getArchivePhase48OpsReport');
    expect(page).toContain('Phase 48');
    expect(page).toContain('phase48Ops.report.subsequent_run_status');
    expect(page).toContain('phase48SubsequentRunStatus');
    expect(hub).toContain('Phase 48 subsequent run');
    expect(hub).toContain('Phase 48 drift');
    expect(hub).toContain('phase48SubsequentRunStatus');
    expect(hub).toContain('phase48DriftPerformance');
  });
});
