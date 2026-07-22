import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_PHASE44_REPORT_VERSION,
  emptyArchivePhase44OpsReport,
} from './archive-phase44';

const sql = readFileSync(
  new URL(
    '../../../supabase/phase44_docusign_archive_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const phase43 = readFileSync(
  new URL(
    '../../../supabase/phase43_docusign_first_quarterly_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const lib = readFileSync(
  new URL('./archive-phase44.ts', import.meta.url),
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
const campaigns = readFileSync(
  new URL('./archive-campaigns.ts', import.meta.url),
  'utf8',
);

describe('Phase 44 DocuSign archive drift/backfill ops', () => {
  it('shapes the phase44 ops report contract and empty helper', () => {
    const empty = emptyArchivePhase44OpsReport();
    expect(empty.version).toBe(ARCHIVE_PHASE44_REPORT_VERSION);
    expect(empty.drift_health).toBe('unknown');
    expect(empty.backfill_health).toBe('unknown');
    expect(empty.alert_delivery).toBe('none');
    expect(empty.critical_alert_count).toBe(0);
    expect(empty.drift_snapshots).toEqual([]);
    expect(empty.alerts).toEqual([]);
    expect(empty.destination_key).toBe('ops_alerts');
  });

  it('is rerunnable and advances Phase 43 without rebuilding prior rails', () => {
    expect((sql.split('$$').length - 1) % 2).toBe(0);
    expect(sql).toContain('phase43_docusign_first_quarterly_ops');
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_drift_snapshots',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_backfill_snapshots',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_phase44_ops_alerts',
    );
    expect(sql).not.toContain(
      'create table if not exists public.os_docusign_first_quarterly_runbook_evidence',
    );
    expect(sql).not.toContain(
      'create table if not exists public.os_docusign_archive_campaigns',
    );
    expect(sql).not.toContain(
      'create table if not exists public.os_docusign_archive_governance_receipts',
    );
    expect(phase43).toContain('get_docusign_first_quarterly_ops_phase43');
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

  it('records drift/backfill snapshots and critical windows with grants', () => {
    expect(sql).toContain('record_docusign_archive_drift_snapshot_phase44');
    expect(sql).toContain('record_docusign_archive_backfill_snapshot_phase44');
    expect(sql).toContain('list_docusign_archive_phase44_critical_windows');
    expect(sql).toContain('record_docusign_archive_phase44_ops_alert');
    expect(sql).toContain('get_docusign_archive_phase44_ops_report');
    expect(sql).toContain('phase44_docusign_ops_safe_metadata');
    expect(sql).toContain('docusign_archive_remaining_unhashed_count');
    expect(sql).toContain('docusign_archive_quarantine_backlog_count');
    expect(sql).toContain('docusign_archive_quarantine_oldest_age_days');
    expect(sql).toContain('window_key text not null unique');
    expect(sql).toContain('integrity_drift_burst');
    expect(sql).toContain('quarantine_aging_breach');
    expect(sql).toContain('quarantine_backlog_high');
    expect(sql).toContain('backfill_stalled');
    expect(sql).toContain('full_scan_overdue');
    expect(sql).toContain('first_quarterly_still_gated');
    expect(sql).toContain('storage_unavailable_elevated');
    expect(sql).toContain(
      'Phase 44 DocuSign archive ops evidence is append-only',
    );
    expect(sql).toMatch(
      /grant execute on function public\.get_docusign_archive_phase44_ops_report\(\)[\s\S]*authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.list_docusign_archive_phase44_critical_windows\(integer\)[\s\S]*authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_docusign_archive_drift_snapshot_phase44\([\s\S]*to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_docusign_archive_backfill_snapshot_phase44\([\s\S]*to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_docusign_archive_phase44_ops_alert\(jsonb\)[\s\S]*to service_role/,
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
    expect(lib).toContain('getArchivePhase44OpsReport');
    expect(lib).toContain('runArchivePhase44OpsTick');
    expect(lib).toContain('webhookUrl');
    expect(lib).toContain('ops_alerts');
    expect(campaigns).toContain('runFirstQuarterlyGatedOps');
  });

  it('wires worker tick after campaign/governance and hub Phase 44 badges', () => {
    expect(route).toContain('runArchivePhase44OpsTick');
    expect(route).toContain('runFirstQuarterlyGatedOps');
    expect(route).toContain('phase44_ops_ok');
    expect(route.lastIndexOf('runArchivePhase44OpsTick')).toBeGreaterThan(
      route.indexOf('runFirstQuarterlyGatedOps'),
    );
    expect(page).toContain('getArchivePhase44OpsReport');
    expect(page).toContain('Phase 44');
    expect(page).toContain('phase44Ops.report.drift_health');
    expect(page).toContain('phase44BackfillHealth');
    expect(hub).toContain('Phase 44 drift');
    expect(hub).toContain('Phase 44 backfill');
    expect(hub).toContain('Phase 44 alerts');
    expect(hub).toContain('phase44DriftHealth');
  });
});
