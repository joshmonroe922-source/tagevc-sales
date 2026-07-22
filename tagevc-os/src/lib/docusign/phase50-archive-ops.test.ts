import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_PHASE50_REPORT_VERSION,
  emptyArchivePhase50OpsReport,
} from './archive-phase50';

const sql = readFileSync(
  new URL(
    '../../../supabase/phase50_docusign_archive_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const phase49 = readFileSync(
  new URL(
    '../../../supabase/phase49_docusign_archive_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const lib = readFileSync(
  new URL('./archive-phase50.ts', import.meta.url),
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

describe('Phase 50 DocuSign cadence trends, second-approver reminders, recurring visibility', () => {
  it('shapes the phase50 ops report contract and empty helper', () => {
    const empty = emptyArchivePhase50OpsReport();
    expect(empty.version).toBe(ARCHIVE_PHASE50_REPORT_VERSION);
    expect(empty.cadence_trend_direction).toBe('unknown');
    expect(empty.cadence_consecutive_healthy_snapshots).toBe(0);
    expect(empty.recurring_process_health).toBe('unknown');
    expect(empty.recurring_quarters_tracked).toBe(0);
    expect(empty.pending_second_approver_reminder_count).toBe(0);
    expect(empty.reminders_sent_7d).toBe(0);
    expect(empty.alert_delivery).toBe('none');
    expect(empty.latest_cadence_trend).toBeNull();
    expect(empty.latest_recurring_visibility).toBeNull();
    expect(empty.alerts).toEqual([]);
    expect(empty.destination_key).toBe('ops_alerts');
    expect(empty.never_creates_voids_or_resends_envelopes).toBe(true);
    expect(empty.never_auto_activates).toBe(true);
  });

  it('is rerunnable and bootstraps Phase 49 helpers without rebuilding prior rails', () => {
    expect((sql.split('$$').length - 1) % 2).toBe(0);
    expect(sql).toContain('phase49_docusign_archive_ops');
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_cadence_trend_snapshots',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_second_approver_reminders',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_recurring_visibility_snapshots',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_phase50_ops_alerts',
    );
    expect(sql).not.toContain(
      'create table if not exists public.os_docusign_archive_budget_revision_proposals',
    );
    expect(phase49).toContain('propose_docusign_budget_revision_phase49');
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

  it('records cadence trends, recurring visibility, and reminders without ever activating a proposal', () => {
    expect(sql).toContain('record_docusign_cadence_trend_snapshot_phase50');
    expect(sql).toContain('record_docusign_recurring_visibility_snapshot_phase50');
    expect(sql).toContain('list_docusign_archive_phase50_critical_windows');
    expect(sql).toContain('record_docusign_second_approver_reminder_phase50');
    expect(sql).toContain('record_docusign_archive_phase50_ops_alert');
    expect(sql).toContain('get_docusign_archive_phase50_ops_report');
    expect(sql).toContain('phase50_docusign_ops_safe_metadata');
    expect(sql).toContain('phase49_docusign_ops_safe_metadata');
    expect(sql).not.toMatch(
      /\bcall\b[\s\S]{0,40}approve_docusign_budget_revision_proposal_phase49|:=\s*public\.approve_docusign_budget_revision_proposal_phase49/,
    );
    expect(sql).toContain('never_activates');
    expect(sql).toContain('never_auto_activates');
    expect(sql).toContain('cadence_trend_declining');
    expect(sql).toContain('budget_revision_second_approver_reminder');
    expect(sql).toContain('recurring_process_health_critical');
    expect(sql).toContain(
      'Phase 50 DocuSign archive ops evidence is append-only',
    );
    expect(sql).toMatch(
      /grant execute on function public\.get_docusign_archive_phase50_ops_report\(\)[\s\S]*authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_docusign_cadence_trend_snapshot_phase50\([\s\S]*to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_docusign_second_approver_reminder_phase50\([\s\S]*to service_role/,
    );
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
    expect(lib).toContain('getArchivePhase50OpsReport');
    expect(lib).toContain('runArchivePhase50OpsTick');
    expect(lib).toContain('webhookUrl');
    expect(lib).toContain('ops_alerts');
    expect(lib).toContain('never_activates');
  });

  it('wires worker tick after Phase 49 and hub Phase 50 badges', () => {
    expect(route).toContain('runArchivePhase50OpsTick');
    expect(route).toContain('runArchivePhase49OpsTick');
    expect(route).toContain('phase50_ops_ok');
    expect(route.lastIndexOf('runArchivePhase50OpsTick')).toBeGreaterThan(
      route.lastIndexOf('runArchivePhase49OpsTick'),
    );
    expect(page).toContain('getArchivePhase50OpsReport');
    expect(page).toContain('Phase 50');
    expect(page).toContain('phase50Ops.report.cadence_trend_direction');
    expect(page).toContain('phase50CadenceTrendDirection');
    expect(hub).toContain('Phase 50 cadence trend');
    expect(hub).toContain('phase50CadenceTrendDirection');
    expect(hub).toContain('phase50PendingReminderCount');
  });
});
