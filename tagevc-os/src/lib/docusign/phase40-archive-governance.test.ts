import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeBoundedBase64 } from './archive-contracts';

const sql = readFileSync(
  new URL('../../../supabase/phase40_docusign_archive_governance.sql', import.meta.url),
  'utf8',
);
const worker = readFileSync(
  new URL('./archive-governance.ts', import.meta.url),
  'utf8',
);
const signedDocs = readFileSync(new URL('./signed-docs.ts', import.meta.url), 'utf8');
const route = readFileSync(
  new URL('../../app/api/docusign/archive-governance-worker/route.ts', import.meta.url),
  'utf8',
);

describe('Phase 40 DocuSign archive governance', () => {
  it('is rerunnable and fences bounded leased work', () => {
    expect((sql.split('$$').length - 1) % 2).toBe(0);
    expect(sql).toContain('phase39');
    expect(sql).toMatch(/p_limit,5\),1\),10/);
    expect(sql).toMatch(/lease_token is distinct from p_lease_token/);
    expect(sql).toMatch(/fence_version<>p_fence_version/);
    expect(sql).toContain('p_item_cursor<=v_run.cursor_key');
    expect(sql).toContain('on conflict(receipt_key) do nothing');
    expect(sql).toContain('os_docusign_archive_gov_one_active');
  });

  it('binds receipts to exact durable identity without content evidence', () => {
    const receiptTable = sql.slice(
      sql.indexOf(
        'create table if not exists public.os_docusign_archive_governance_receipts',
      ),
      sql.indexOf(
        'create table if not exists public.os_docusign_archive_quarantine',
      ),
    );
    for (const field of [
      'envelope_id',
      'document_id',
      'entity_id',
      'completed_event_id',
      'lineage_id',
      'manifest_id',
      'signed_file_id',
      'expected_sha256',
      'observed_sha256',
      'evidence_sha256',
    ]) {
      expect(receiptTable).toContain(field);
    }
    expect(receiptTable).not.toMatch(
      /content_base64|pdf_content|certificate_content|raw_payload/,
    );
    expect(sql).toContain('docusign_phase40_completed_binding');
    expect(sql).toContain('os_docusign_archive_gov_receipts_no_truncate');
    expect(sql).toContain('os_docusign_archive_gov_events_immutable');
    expect(sql).toContain('os_docusign_archive_gov_events_no_truncate');
    expect(sql).toContain('to service_role');
    expect(sql).toContain('public.can_access_entity(entity_id)');
  });

  it('separates availability failures from drift and quarantines only drift', () => {
    expect(sql).toContain("'provider_unavailable'");
    expect(sql).toContain("'storage_unavailable'");
    expect(sql).toContain("'content_drift'");
    expect(sql).toMatch(
      /if v_outcome in \('content_drift','quarantined'\) then[\s\S]*archive_quarantine/,
    );
    expect(sql).toContain("interval '7 days'");
    expect(sql).toContain("interval '90 days'");
    expect(worker).toContain('object_storage_unavailable');
    expect(worker).toContain('archive_bytes_unavailable');
  });

  it('only downloads and hashes actual bounded PDF bytes', () => {
    expect(signedDocs).toContain('archiveProviderCompletedDocument');
    expect(signedDocs).toContain('readBoundedResponseBuffer');
    expect(signedDocs).toContain('assertPdfPayload');
    expect(worker).toContain('describeArchiveBytes(buffer)');
    expect(worker).not.toMatch(
      /createEnvelopeFromTemplate|dispatchPreparedDocuSignSend|sendEnvelope/,
    );
    expect(route).toContain('CRON_SECRET');
    expect(route).toContain("workerName: `archive-");
  });

  it('strictly rejects malformed or oversized inline base64', () => {
    expect(decodeBoundedBase64(Buffer.from('%PDF-x').toString('base64'), 16, 'x'))
      .toEqual(Buffer.from('%PDF-x'));
    expect(() => decodeBoundedBase64('%%%%', 16, 'x')).toThrow('invalid');
    expect(() =>
      decodeBoundedBase64(Buffer.alloc(17).toString('base64'), 16, 'x'),
    ).toThrow('exceeds');
  });
});
