import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapCampaignParam } from './archive-campaigns';

const sql = readFileSync(
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
  new URL('../../app/api/docusign/archive-governance-worker/route.ts', import.meta.url),
  'utf8',
);
const page = readFileSync(
  new URL('../../app/(app)/shared-services/legal/docusign/page.tsx', import.meta.url),
  'utf8',
);
const vercel = readFileSync(
  new URL('../../../vercel.json', import.meta.url),
  'utf8',
);
const phase41 = readFileSync(
  new URL(
    '../../../supabase/phase41_docusign_archive_campaigns.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Phase 42 DocuSign archive campaign ops', () => {
  it('is rerunnable and advances Phase 41 without rebuilding campaigns', () => {
    expect((sql.split('$$').length - 1) % 2).toBe(0);
    expect(sql).toContain('phase41_docusign_archive_campaigns');
    expect(sql).toContain(
      'create table if not exists public.os_docusign_archive_campaign_ops_events',
    );
    expect(sql).not.toContain(
      'create table if not exists public.os_docusign_archive_campaigns',
    );
    expect(sql).not.toContain('create table if not exists public.os_docusign_archive_quarantine');
    expect(phase41).toContain('claim_docusign_archive_campaign_work');
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

  it('exposes ops report, quarantine aging list, and milestone recorder', () => {
    expect(sql).toContain('get_docusign_archive_campaign_ops_phase42');
    expect(sql).toContain('list_docusign_archive_quarantine_aging_phase42');
    expect(sql).toContain('record_docusign_campaign_ops_milestone_phase42');
    expect(sql).toContain('quarterly_first_milestone');
    expect(sql).toContain('quarantine_aging_breach');
    expect(sql).toContain('backfill_completed');
    expect(sql).toContain('age_bucket');
    expect(sql).toContain("'over_45'");
    expect(sql).toContain('ops_ready');
    expect(sql).toContain('quarterly_unlocked');
  });

  it('keeps ops events append-only with security_definer grants', () => {
    expect(sql).toContain('Phase 42 DocuSign archive campaign ops events are append-only');
    expect(sql).toContain('security definer');
    expect(sql).toMatch(
      /grant execute on function public\.get_docusign_archive_campaign_ops_phase42\(text\)[\s\S]*authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.list_docusign_archive_quarantine_aging_phase42\([\s\S]*authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_docusign_campaign_ops_milestone_phase42\([\s\S]*to service_role/,
    );
    expect(sql).toContain(
      'revoke all on function public.record_docusign_campaign_ops_milestone_phase42',
    );
  });

  it('keeps evidence metadata-only and never creates/voids/resends envelopes', () => {
    expect(sql).toContain('Evidence = digests/metadata only');
    expect(sql).toContain('Workers never create/void/resend envelopes');
    expect(sql).toContain('phase42_docusign_ops_safe_metadata');
    expect(sql).not.toMatch(
      /content_base64|pdf_content|certificate_content|raw_payload/,
    );
    expect(lib).not.toMatch(
      /createEnvelopeFromTemplate|dispatchPreparedDocuSignSend|sendEnvelope|voidEnvelope/,
    );
    expect(lib).toContain('record_docusign_campaign_ops_milestone_phase42');
    expect(lib).toContain('get_docusign_archive_campaign_ops_phase42');
    expect(lib).toContain('list_docusign_archive_quarantine_aging_phase42');
    expect(lib).toContain('maybeRecordCampaignOpsMilestone');
  });

  it('records milestones on completed/gated and keeps quarterly cron', () => {
    expect(lib).toContain("disposition === 'gated'");
    expect(lib).toContain("disposition === 'already_complete'");
    expect(lib).toContain("status === 'completed'");
    expect(lib).toContain('quarterly_completed');
    expect(lib).toContain('campaign_gated');
    expect(route).toContain('ops_milestone_kind');
    expect(route).toContain('runArchiveCampaignTick');
    expect(vercel).toContain(
      '/api/docusign/archive-governance-worker?mode=full&campaign=quarterly',
    );
    expect(vercel).toContain('0 5 1 * *');
    expect(mapCampaignParam('quarterly')).toBe('quarterly_full_integrity');
  });

  it('surfaces ops readiness strip and aging queue on the DocuSign hub', () => {
    expect(page).toContain('getArchiveCampaignOpsReport');
    expect(page).toContain('Ops readiness');
    expect(page).toContain('Quarantine aging queue');
    expect(page).toContain('First quarterly milestone');
    expect(page).toContain('Phase 42');
    expect(page).toContain('agingQueue');
  });
});
