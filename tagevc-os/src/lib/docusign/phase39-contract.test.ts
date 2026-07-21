import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/phase39_docusign_mapping_archive.sql'),
  'utf8',
);
const signedDocs = readFileSync(
  join(process.cwd(), 'src/lib/docusign/signed-docs.ts'),
  'utf8',
);
const archiveContracts = readFileSync(
  join(process.cwd(), 'src/lib/docusign/archive-contracts.ts'),
  'utf8',
);
const webhook = readFileSync(
  join(process.cwd(), 'src/app/api/docusign/webhook/route.ts'),
  'utf8',
);

describe('Phase 39 DocuSign governance contract', () => {
  it('keeps mapping review independent from send-intent resolution', () => {
    expect(migration).toContain(
      'public.os_docusign_mapping_review_resolutions',
    );
    expect(migration).toContain('public.os_docusign_mapping_review_events');
    expect(migration).toContain("decision in ('assign_identity','retain_quarantine')");
    expect(migration).toContain('reviewed_by <> proposed_by');
    expect(migration).toContain('p_expected_envelope_version');
    expect(migration).toContain("'no_send_side_effect',true");

    const reviewFunction = migration.slice(
      migration.indexOf(
        'create or replace function public.review_docusign_mapping_review_resolution',
      ),
      migration.indexOf(
        'alter table public.os_docusign_signed_files',
      ),
    );
    expect(reviewFunction).not.toMatch(
      /update\s+public\.os_docusign_send_intents/i,
    );
    expect(reviewFunction).toContain("reconciliation_state='repaired'");
    expect(reviewFunction).toContain("status='projection_conflict'");
  });

  it('freezes provider evidence and makes replays explicit', () => {
    expect(migration).toContain('os_docusign_mapping_evidence_frozen');
    expect(migration).toContain("'evidence_version','phase39-v1'");
    expect(migration).toContain('request_id uuid not null unique');
    expect(migration).toContain('event_key text not null unique');
    expect(migration).toContain("'replayed',true");
    expect(migration).toContain("'review_sha256',v_review_hash");
    expect(migration).toContain("v_item.committed_at<now()-interval '30 minutes'");
    expect(migration).toContain(
      "Target entity is not bound to frozen identity claims",
    );
    expect(migration).toContain('mapping_claims_sha256=v_claims_hash');
    expect(migration).toContain('preserve_docusign_adjudicated_mapping');
    expect(migration).toContain(
      'before update or delete on public.os_docusign_mapping_review_events',
    );
    expect(migration).toContain(
      'before truncate on public.os_docusign_mapping_review_events',
    );
  });

  it('binds signed archives to hashes without evidence payload content', () => {
    const manifestTable = migration.slice(
      migration.indexOf(
        'create table if not exists public.os_docusign_archive_manifests',
      ),
      migration.indexOf(
        'alter table public.os_docusign_archive_manifests\n  add column',
      ),
    );
    for (const field of [
      'envelope_id',
      'document_id',
      'entity_id',
      'provider_status',
      'content_length',
      'content_sha256',
      'downloaded_at',
      'source_request_id',
    ]) {
      expect(manifestTable).toContain(field);
    }
    expect(manifestTable).not.toMatch(/content_base64|certificate_content|pdf_content/);
    expect(migration).toContain("'content_replacement_blocked'");
    expect(migration).toContain("'metadata_drift_blocked'");
    expect(migration).toContain("'replacement_manifest_recorded'");
    expect(migration).toContain(
      'Archive document, envelope, and entity binding is invalid',
    );
    expect(migration).toContain(
      'Durable completed provider event is required before archive',
    );
    expect(migration).toContain(
      'grant execute on function public.register_docusign_archive_manifest',
    );
    expect(archiveContracts).toContain("createHash('sha256').update(buffer)");
    expect(signedDocs).toContain('describeArchiveBytes(input.buffer)');
    expect(signedDocs).toContain('readBoundedResponseBuffer');
    expect(signedDocs.indexOf('register_docusign_archive_manifest')).toBeLessThan(
      signedDocs.indexOf('uploadToStorage(\n    storageKey'),
    );
    expect(signedDocs).toContain('upsert: false');
    const postBody = webhook.slice(
      webhook.indexOf('export async function POST'),
    );
    expect(
      postBody.indexOf('const eventPersist = await insertDocuSignEvent'),
    ).toBeLessThan(
      postBody.indexOf('applyDocuSignWebhook({'),
    );
    expect(webhook).toContain("createHash('sha256').update(rawBody)");
  });
});
