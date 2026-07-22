import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_PHASE46_REPORT_VERSION,
  emptyArchivePhase46OpsReport,
} from './archive-phase46';

const sql = readFileSync(
  new URL(
    '../../../supabase/phase46_docusign_archive_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const phase45 = readFileSync(
  new URL(
    '../../../supabase/phase45_docusign_archive_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const lib = readFileSync(
  new URL('./archive-phase46.ts', import.meta.url),
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

describe('Phase 46 DocuSign archive first-quarterly/recurring/drift ops', () => {
  it('shapes the phase46 ops report contract and empty helper', () => {
    const empty = emptyArchivePhase46OpsReport();
    expect(empty.version).toBe(ARCHIVE_PHASE46_REPORT_VERSION);
    expect(empty.first_quarterly_status).toBe('incomplete');
    expect(empty.recurring_quarterly_status).toBe('unarmed');
    expect(empty.drift_revision_status).toBe('none');
    expect(empty.cadence_health).toBe('unknown');
    expect(empty.alert_delivery).toBe('none');
    expect(empty.first_quarterly_completed).toBe(false);
    expect(empty.recurring_quarterly_armed).toBe(false);
    expect(empty.latest_completion).toBeNull();
    expect(empty.latest_arm).toBeNull();
    expect(empty.alerts).toEqual([]);
    expect(empty.destination_key).toBe('ops_alerts');
  });

  it('is rerunnable and advances Phase 45 without rebuilding prior rails', () => {
    expect((sql.split('$$').length - 1) % 2).toBe(0);
    expect(sql).toContain('phase45_docusign_archive_ops');
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_first_quarterly_completion',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_recurring_quarterly_arms',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_drift_budget_revisions',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_integrity_cadence_ops',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_phase46_ops_alerts',
    );
    expect(sql).not.toContain(
      'create table if not exists public.os_docusign_archive_drift_budgets',
    );
    expect(sql).not.toContain(
      'create table if not exists public.os_docusign_archive_gate_clearing_evidence',
    );
    expect(sql).not.toContain(
      'create table if not exists public.os_docusign_first_quarterly_runbook_evidence',
    );
    expect(phase45).toContain('get_docusign_archive_phase45_ops_report');
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

  it('records completion, arms, tighten/activate, cadence, and alerts with grants', () => {
    expect(sql).toContain('complete_docusign_first_quarterly_review_phase46');
    expect(sql).toContain('arm_docusign_recurring_quarterly_phase46');
    expect(sql).toContain('tighten_docusign_drift_budget_phase46');
    expect(sql).toContain('activate_docusign_drift_budget_revision_phase46');
    expect(sql).toContain('record_docusign_integrity_cadence_ops_phase46');
    expect(sql).toContain('list_docusign_archive_phase46_critical_windows');
    expect(sql).toContain('record_docusign_archive_phase46_ops_alert');
    expect(sql).toContain('get_docusign_archive_phase46_ops_report');
    expect(sql).toContain('phase46_docusign_ops_safe_metadata');
    expect(sql).toContain('evaluate_docusign_first_quarterly_gates_phase43');
    expect(sql).toContain('first_quarterly_ready');
    expect(sql).toContain('first_quarterly_completed');
    expect(sql).toContain('cadence_months');
    expect(sql).toContain("status in ('completed','blocked')");
    expect(sql).toContain("status in ('armed','disarmed')");
    expect(sql).toContain("status in ('proposed','activated')");
    expect(sql).toContain('baseline_snapshot_id');
    expect(sql).toContain('proposed_max_content_drift');
    expect(sql).toContain('last_quarterly_at');
    expect(sql).toContain('quarterly_overdue');
    expect(sql).toContain('window_key text not null unique');
    expect(sql).toContain('first_quarterly_incomplete');
    expect(sql).toContain('recurring_unarmed');
    expect(sql).toContain('drift_budget_tighten_due');
    expect(sql).toContain('cadence_unhealthy');
    expect(sql).toContain(
      'Phase 46 DocuSign archive ops evidence is append-only',
    );
    expect(sql).toMatch(
      /grant execute on function public\.get_docusign_archive_phase46_ops_report\(\)[\s\S]*authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.list_docusign_archive_phase46_critical_windows\(integer\)[\s\S]*authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.complete_docusign_first_quarterly_review_phase46\(jsonb\)[\s\S]*to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.arm_docusign_recurring_quarterly_phase46\(integer,jsonb\)[\s\S]*to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.tighten_docusign_drift_budget_phase46\([\s\S]*to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.activate_docusign_drift_budget_revision_phase46\([\s\S]*to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_docusign_integrity_cadence_ops_phase46\([\s\S]*to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_docusign_archive_phase46_ops_alert\(jsonb\)[\s\S]*to service_role/,
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
    expect(lib).toContain('getArchivePhase46OpsReport');
    expect(lib).toContain('runArchivePhase46OpsTick');
    expect(lib).toContain('webhookUrl');
    expect(lib).toContain('ops_alerts');
    expect(lib).toContain('firm_signed_archives');
  });

  it('wires worker tick after Phase 45 and hub Phase 46 badges', () => {
    expect(route).toContain('runArchivePhase46OpsTick');
    expect(route).toContain('runArchivePhase45OpsTick');
    expect(route).toContain('phase46_ops_ok');
    expect(route.lastIndexOf('runArchivePhase46OpsTick')).toBeGreaterThan(
      route.lastIndexOf('runArchivePhase45OpsTick'),
    );
    expect(page).toContain('getArchivePhase46OpsReport');
    expect(page).toContain('Phase 46');
    expect(page).toContain('phase46Ops.report.first_quarterly_status');
    expect(page).toContain('phase46FirstQuarterlyStatus');
    expect(hub).toContain('Phase 46 first quarterly');
    expect(hub).toContain('Phase 46 recurring');
    expect(hub).toContain('Phase 46 cadence');
    expect(hub).toContain('phase46FirstQuarterlyStatus');
    expect(hub).toContain('phase46RecurringStatus');
    expect(hub).toContain('phase46CadenceHealth');
  });
});
