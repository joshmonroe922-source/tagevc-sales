import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_PHASE52_REPORT_VERSION,
  emptyArchivePhase52OpsReport,
} from './archive-phase52';

const sql = readFileSync(
  new URL(
    '../../../supabase/phase52_docusign_archive_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const phase51 = readFileSync(
  new URL(
    '../../../supabase/phase51_docusign_archive_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const lib = readFileSync(
  new URL('./archive-phase52.ts', import.meta.url),
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

describe('Phase 52 DocuSign third→fourth escalation chain', () => {
  it('shapes the phase52 ops report contract and empty helper', () => {
    const empty = emptyArchivePhase52OpsReport();
    expect(empty.version).toBe(ARCHIVE_PHASE52_REPORT_VERSION);
    expect(empty.chain_threshold_days).toBe(3);
    expect(empty.chain_active).toBe(false);
    expect(empty.fourth_approver_escalations_7d).toBe(0);
    expect(empty.pending_fourth_approver_count).toBe(0);
    expect(empty.alerts).toEqual([]);
    expect(empty.destination_key).toBe('ops_alerts');
    expect(empty.never_creates_voids_or_resends_envelopes).toBe(true);
    expect(empty.never_auto_activates).toBe(true);
    expect(ARCHIVE_PHASE52_REPORT_VERSION).toBe('phase52-v1');
  });

  it('is rerunnable and bootstraps Phase 51 helpers without rebuilding prior rails', () => {
    expect((sql.split('$$').length - 1) % 2).toBe(0);
    expect(sql).toContain('phase51_docusign_archive_ops.sql');
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_phase52_escalation_chain_config',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_fourth_approver_escalations',
    );
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_phase52_ops_alerts',
    );
    expect(sql).not.toContain(
      'create table if not exists public.os_docusign_archive_third_approver_escalations',
    );
    expect(phase51).toContain(
      'create table if not exists public.os_docusign_archive_third_approver_escalations',
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

  it('escalates third→fourth without ever approving/activating or mutating envelopes', () => {
    expect(sql).toContain('escalate_docusign_approval_chain_phase52');
    expect(sql).toContain('list_docusign_archive_phase52_critical_windows');
    expect(sql).toContain('record_docusign_archive_phase52_ops_alert');
    expect(sql).toContain('get_docusign_archive_phase52_ops_report');
    expect(sql).toContain('phase52_docusign_ops_safe_metadata');
    expect(sql).not.toMatch(
      /\bcall\b[\s\S]{0,40}approve_docusign_budget_revision_proposal_phase49|:=\s*public\.approve_docusign_budget_revision_proposal_phase49/,
    );
    expect(sql).toContain('never_activates');
    expect(sql).toContain('never_auto_activates');
    expect(sql).toContain('fourth_approver_escalation_raised');
    expect(sql).toContain('escalation_chain_aging_critical');
    expect(sql).toContain(
      'Phase 52 DocuSign archive ops evidence is append-only',
    );
    expect(sql).toMatch(
      /grant execute on function public\.get_docusign_archive_phase52_ops_report\(\)[\s\S]*authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.escalate_docusign_approval_chain_phase52\([\s\S]*to service_role/,
    );
  });

  it('fourth-approver escalation only fires after third escalation ages past threshold with still 1 approver', () => {
    expect(sql).toMatch(
      /count\(distinct a\.actor_id\) filter \(where a\.decision='approve'\) = 1/,
    );
    expect(sql).toMatch(
      /t\.created_at <= now\(\) - make_interval\(days => v_threshold\)/,
    );
    expect(sql).toMatch(/os_docusign_archive_third_approver_escalations/);
  });

  it('keeps evidence metadata-only and never creates/voids/resends envelopes', () => {
    expect(sql).toContain('Never create/void/resend envelopes');
    expect(sql).not.toMatch(/os_store_snapshots/);
    expect(lib).not.toMatch(
      /createEnvelopeFromTemplate|dispatchPreparedDocuSignSend|sendEnvelope|voidEnvelope/,
    );
    expect(lib).toContain('getArchivePhase52OpsReport');
    expect(lib).toContain('runArchivePhase52OpsTick');
    expect(lib).toContain('webhookUrl');
    expect(lib).toContain('never_activates');
  });

  it('wires worker tick after Phase 51 and hub Phase 52 badges', () => {
    expect(route).toContain('runArchivePhase52OpsTick');
    expect(route).toContain('runArchivePhase51OpsTick');
    expect(route).toContain('phase52_ops_ok');
    expect(route.lastIndexOf('runArchivePhase52OpsTick')).toBeGreaterThan(
      route.lastIndexOf('runArchivePhase51OpsTick'),
    );
    expect(page).toContain('getArchivePhase52OpsReport');
    expect(page).toContain('Phase 52');
    expect(hub).toContain('Phase 52');
    expect(hub).toContain('phase52PendingFourthCount');
    expect(hub).toContain('phase52ChainThresholdDays');
  });
});
