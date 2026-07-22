import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapCampaignParam } from './archive-campaigns';

const sql = readFileSync(
  new URL(
    '../../../supabase/phase43_docusign_first_quarterly_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const phase42 = readFileSync(
  new URL(
    '../../../supabase/phase42_docusign_campaign_ops.sql',
    import.meta.url,
  ),
  'utf8',
);
const lib = readFileSync(
  new URL('./archive-campaigns.ts', import.meta.url),
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
const actions = readFileSync(
  new URL(
    '../../app/(app)/shared-services/legal/docusign/actions.ts',
    import.meta.url,
  ),
  'utf8',
);
const hub = readFileSync(
  new URL(
    '../../components/shared-services/docusign-hub-actions.tsx',
    import.meta.url,
  ),
  'utf8',
);
const vercel = readFileSync(
  new URL('../../../vercel.json', import.meta.url),
  'utf8',
);

describe('Phase 43 DocuSign first quarterly gated ops', () => {
  it('is rerunnable and advances Phase 42 without rebuilding ops rails', () => {
    expect((sql.split('$$').length - 1) % 2).toBe(0);
    expect(sql).toContain('phase42_docusign_campaign_ops');
    expect(sql).toContain(
      'create table if not exists public.os_docusign_first_quarterly_runbook_evidence',
    );
    expect(sql).not.toContain(
      'create table if not exists public.os_docusign_archive_campaign_ops_events',
    );
    expect(sql).not.toContain(
      'create table if not exists public.os_docusign_archive_campaigns',
    );
    expect(sql).not.toContain(
      'create table if not exists public.os_docusign_archive_quarantine',
    );
    expect(phase42).toContain('get_docusign_archive_campaign_ops_phase42');
    expect(phase42).toContain('list_docusign_archive_quarantine_aging_phase42');
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

  it('unlocks first quarterly only when backfill=0 and quarantine aged', () => {
    expect(sql).toContain('evaluate_docusign_first_quarterly_gates_phase43');
    expect(sql).toContain('v_backfill_complete := v_remaining <= 0');
    expect(sql).toContain('v_aging_ok := v_oldest <= 45');
    expect(sql).toContain('v_backlog_ok := v_quarantine <= 25');
    expect(sql).toContain(
      'v_unlocked := v_backfill_complete and v_aging_ok and v_backlog_ok',
    );
    expect(sql).toContain("'cta_eligible'");
    expect(sql).toContain('quarantine_aged');
    expect(sql).toContain(
      'raise exception \'Phase 43 unlock_recorded requires backfill=0 and quarantine aged\'',
    );
  });

  it('records append-only runbook evidence with security_definer grants', () => {
    expect(sql).toContain('record_docusign_first_quarterly_runbook_phase43');
    expect(sql).toContain('get_docusign_first_quarterly_ops_phase43');
    expect(sql).toContain(
      'Phase 43 DocuSign first quarterly runbook evidence is append-only',
    );
    expect(sql).toContain('security definer');
    expect(sql).toContain('unlock_recorded');
    expect(sql).toContain('runbook_ack');
    expect(sql).toContain('first_quarterly_started');
    expect(sql).toContain('first_quarterly_completed');
    expect(sql).toMatch(
      /grant execute on function public\.get_docusign_first_quarterly_ops_phase43\(text\)[\s\S]*authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.evaluate_docusign_first_quarterly_gates_phase43\(text\)[\s\S]*authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_docusign_first_quarterly_runbook_phase43\([\s\S]*to service_role/,
    );
    expect(sql).toContain(
      'revoke all on function public.record_docusign_first_quarterly_runbook_phase43',
    );
  });

  it('keeps evidence metadata-only and never creates/voids/resends envelopes', () => {
    expect(sql).toContain('Evidence = digests/metadata only');
    expect(sql).toContain('Never create/void/resend envelopes');
    expect(sql).toContain('phase43_docusign_runbook_safe_metadata');
    expect(sql).toContain('phase42_docusign_ops_safe_metadata');
    expect(sql).not.toMatch(
      /content_base64|pdf_content|certificate_content|raw_payload/,
    );
    expect(lib).not.toMatch(
      /createEnvelopeFromTemplate|dispatchPreparedDocuSignSend|sendEnvelope|voidEnvelope/,
    );
    expect(lib).toContain('runFirstQuarterlyGatedOps');
    expect(lib).toContain('getFirstQuarterlyOpsReport');
    expect(lib).toContain('recordFirstQuarterlyRunbook');
    expect(lib).toContain('evaluateFirstQuarterlyGates');
  });

  it('wires worker quarterly path through gated first-quarterly ops', () => {
    expect(route).toContain('runFirstQuarterlyGatedOps');
    expect(route).toContain('first_quarterly_unlocked');
    expect(route).toContain('first_quarterly_cta_eligible');
    expect(route).toContain('first_quarterly_runbook');
    expect(vercel).toContain(
      '/api/docusign/archive-governance-worker?mode=full&campaign=quarterly',
    );
    expect(mapCampaignParam('quarterly')).toBe('quarterly_full_integrity');
  });

  it('surfaces gated CTA when unlocked on the DocuSign hub', () => {
    expect(page).toContain('getFirstQuarterlyOpsReport');
    expect(page).toContain('firstQuarterlyCtaEligible');
    expect(page).toContain('Phase 43');
    expect(page).toContain('First quarterly runbook evidence');
    expect(page).toContain('CTA ready');
    expect(hub).toContain('Run first quarterly (gated)');
    expect(hub).toContain('firstQuarterlyCtaEligible');
    expect(hub).toContain('runFirstQuarterlyGatedOpsAction');
    expect(actions).toContain('runFirstQuarterlyGatedOpsAction');
    expect(actions).toContain('acknowledgeRunbook: true');
  });
});
