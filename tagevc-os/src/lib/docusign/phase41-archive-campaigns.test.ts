import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapCampaignParam } from './archive-campaigns';

const sql = readFileSync(
  new URL(
    '../../../supabase/phase41_docusign_archive_campaigns.sql',
    import.meta.url,
  ),
  'utf8',
);
const lib = readFileSync(
  new URL('./archive-campaigns.ts', import.meta.url),
  'utf8',
);
const worker = readFileSync(
  new URL('./archive-governance.ts', import.meta.url),
  'utf8',
);
const route = readFileSync(
  new URL('../../app/api/docusign/archive-governance-worker/route.ts', import.meta.url),
  'utf8',
);
const vercel = readFileSync(
  new URL('../../../vercel.json', import.meta.url),
  'utf8',
);

describe('Phase 41 DocuSign archive campaigns', () => {
  it('is rerunnable and depends on Phase 40 governance without rebuilding it', () => {
    expect((sql.split('$$').length - 1) % 2).toBe(0);
    expect(sql).toContain('phase40_docusign_archive_governance');
    expect(sql).toContain('create table if not exists public.os_docusign_archive_campaigns');
    expect(sql).toContain('create table if not exists public.os_docusign_archive_campaign_receipts');
    expect(sql).toContain("legacy_backfill_completion");
    expect(sql).toContain("quarterly_full_integrity");
    expect(sql).toContain('os_docusign_archive_camp_one_active');
    expect(sql).not.toContain('create table if not exists public.os_docusign_archive_governance_runs');
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

  it('exposes open/claim/finish plus quarterly due detector and gated progress', () => {
    expect(sql).toContain('is_docusign_quarterly_full_integrity_due');
    expect(sql).toContain('open_docusign_archive_campaign');
    expect(sql).toContain('claim_docusign_archive_campaign_work');
    expect(sql).toContain('finish_docusign_archive_campaign');
    expect(sql).toContain('fail_docusign_archive_campaign');
    expect(sql).toContain('list_docusign_archive_campaign_hub');
    expect(sql).toContain('governance_run_id');
    expect(sql).toContain('gate_remaining_unhashed');
    expect(sql).toContain('gate_quarantine_backlog');
    expect(sql).toContain("'not_due'");
    expect(sql).toContain("'gated'");
    expect(sql).toContain('schedule_window_start');
  });

  it('grants security_definer wrappers used by security_invoker progress view', () => {
    expect(sql).toContain('with (security_invoker=true)');
    expect(sql).toContain('os_docusign_archive_campaign_progress');
    expect(sql).toMatch(
      /grant execute on function public\.docusign_archive_remaining_unhashed_count\(text\)[\s\S]*authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.is_docusign_quarterly_full_integrity_due\(timestamptz\)[\s\S]*authenticated, service_role/,
    );
    expect(sql).toContain(
      'grant select on public.os_docusign_archive_campaign_progress',
    );
  });

  it('keeps evidence metadata-only and never creates/voids/resends envelopes', () => {
    expect(sql).toContain('Evidence = digests/metadata only');
    expect(sql).toContain('Workers never create/void/resend envelopes');
    expect(sql).not.toMatch(
      /content_base64|pdf_content|certificate_content|raw_payload/,
    );
    expect(lib).not.toMatch(
      /createEnvelopeFromTemplate|dispatchPreparedDocuSignSend|sendEnvelope|voidEnvelope/,
    );
    expect(worker).not.toMatch(
      /createEnvelopeFromTemplate|dispatchPreparedDocuSignSend|sendEnvelope/,
    );
    expect(lib).toContain('runArchiveGovernanceWorker');
    expect(lib).toContain('claim_docusign_archive_campaign_work');
    expect(lib).toContain("disposition === 'not_due'");
  });

  it('wires monthly quarterly campaign cron that can no-op until due', () => {
    expect(route).toContain('mapCampaignParam');
    expect(route).toContain('runArchiveCampaignTick');
    expect(route).toContain("disposition === 'not_due'");
    expect(vercel).toContain(
      '/api/docusign/archive-governance-worker?mode=full&campaign=quarterly',
    );
    expect(vercel).toContain('0 5 1 * *');
    expect(mapCampaignParam('quarterly')).toBe('quarterly_full_integrity');
    expect(mapCampaignParam('backfill')).toBe('legacy_backfill_completion');
    expect(mapCampaignParam(null)).toBeNull();
  });
});
