import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_PHASE45_REPORT_VERSION,
  emptyArchivePhase45OpsReport,
} from './archive-phase45';

const sql = readFileSync(
  new URL(
    '../../../supabase/phase45_docusign_archive_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const phase44 = readFileSync(
  new URL(
    '../../../supabase/phase44_docusign_archive_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const lib = readFileSync(
  new URL('./archive-phase45.ts', import.meta.url),
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

describe('Phase 45 DocuSign archive gate/drift/cadence ops', () => {
  it('shapes the phase45 ops report contract and empty helper', () => {
    const empty = emptyArchivePhase45OpsReport();
    expect(empty.version).toBe(ARCHIVE_PHASE45_REPORT_VERSION);
    expect(empty.gate_clearing_progress).toBe('unknown');
    expect(empty.drift_budget_health).toBe('unknown');
    expect(empty.cadence_health).toBe('unknown');
    expect(empty.alert_delivery).toBe('none');
    expect(empty.steps_cleared).toBe(0);
    expect(empty.steps_total).toBe(6);
    expect(empty.recurring_quarterly_armed).toBe(false);
    expect(empty.gate_evidence).toEqual([]);
    expect(empty.alerts).toEqual([]);
    expect(empty.destination_key).toBe('ops_alerts');
  });

  it('is rerunnable and advances Phase 44 without rebuilding prior rails', () => {
    expect((sql.split('$$').length - 1) % 2).toBe(0);
    expect(sql).toContain('phase44_docusign_archive_ops');
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_drift_budgets',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_gate_clearing_evidence',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_integrity_cadence_snapshots',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_phase45_ops_alerts',
    );
    expect(sql).not.toContain(
      'create table if not exists public.os_docusign_archive_drift_snapshots',
    );
    expect(sql).not.toContain(
      'create table if not exists public.os_docusign_archive_backfill_snapshots',
    );
    expect(sql).not.toContain(
      'create table if not exists public.os_docusign_first_quarterly_runbook_evidence',
    );
    expect(phase44).toContain('get_docusign_archive_phase44_ops_report');
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

  it('records budgets, gate clearing, cadence, and alerts with grants', () => {
    expect(sql).toContain('upsert_docusign_archive_drift_budget_phase45');
    expect(sql).toContain('evaluate_docusign_gate_clearing_phase45');
    expect(sql).toContain('record_docusign_integrity_cadence_snapshot_phase45');
    expect(sql).toContain('list_docusign_archive_phase45_critical_windows');
    expect(sql).toContain('record_docusign_archive_phase45_ops_alert');
    expect(sql).toContain('get_docusign_archive_phase45_ops_report');
    expect(sql).toContain('phase45_docusign_ops_safe_metadata');
    expect(sql).toContain('evaluate_docusign_first_quarterly_gates_phase43');
    expect(sql).toContain('remaining_unhashed_cleared');
    expect(sql).toContain('quarantine_age_cleared');
    expect(sql).toContain('quarantine_backlog_cleared');
    expect(sql).toContain('first_quarterly_ready');
    expect(sql).toContain('first_quarterly_completed');
    expect(sql).toContain('recurring_quarterly_armed');
    expect(sql).toContain('max_content_drift_per_window');
    expect(sql).toContain('max_storage_unavailable');
    expect(sql).toContain("status in ('active','retired')");
    expect(sql).toContain('last_sample_at');
    expect(sql).toContain('next_quarterly_due');
    expect(sql).toContain('sample_overdue');
    expect(sql).toContain('full_overdue');
    expect(sql).toContain('window_key text not null unique');
    expect(sql).toContain('drift_budget_breach');
    expect(sql).toContain('gate_clearing_stalled');
    expect(sql).toContain('recurring_quarterly_unarmed');
    expect(sql).toContain('integrity_cadence_overdue');
    expect(sql).toContain(
      'Phase 45 DocuSign archive ops evidence is append-only',
    );
    expect(sql).toMatch(
      /grant execute on function public\.get_docusign_archive_phase45_ops_report\(\)[\s\S]*authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.list_docusign_archive_phase45_critical_windows\(integer\)[\s\S]*authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.upsert_docusign_archive_drift_budget_phase45\([\s\S]*to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.evaluate_docusign_gate_clearing_phase45\(jsonb\)[\s\S]*to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_docusign_integrity_cadence_snapshot_phase45\([\s\S]*to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_docusign_archive_phase45_ops_alert\(jsonb\)[\s\S]*to service_role/,
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
    expect(lib).toContain('getArchivePhase45OpsReport');
    expect(lib).toContain('runArchivePhase45OpsTick');
    expect(lib).toContain('webhookUrl');
    expect(lib).toContain('ops_alerts');
    expect(lib).toContain('firm_signed_archives');
  });

  it('wires worker tick after Phase 44 and hub Phase 45 badges', () => {
    expect(route).toContain('runArchivePhase45OpsTick');
    expect(route).toContain('runArchivePhase44OpsTick');
    expect(route).toContain('phase45_ops_ok');
    expect(route.lastIndexOf('runArchivePhase45OpsTick')).toBeGreaterThan(
      route.lastIndexOf('runArchivePhase44OpsTick'),
    );
    expect(page).toContain('getArchivePhase45OpsReport');
    expect(page).toContain('Phase 45');
    expect(page).toContain('phase45Ops.report.gate_clearing_progress');
    expect(page).toContain('phase45DriftBudgetHealth');
    expect(hub).toContain('Phase 45 gate');
    expect(hub).toContain('Phase 45 drift budget');
    expect(hub).toContain('Phase 45 cadence');
    expect(hub).toContain('phase45GateProgress');
  });
});
