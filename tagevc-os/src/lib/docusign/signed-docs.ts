/**
 * Fetch completed DocuSign envelope documents into 07_Signed (Phase 23–24).
 * Large files go to Supabase Storage bucket `docusign-signed`; DB keeps metadata.
 */

import { getDocuSignConfig, isDocuSignConfigured } from '@/lib/docusign/config';
import { getDocuSignAccessToken } from '@/lib/docusign/jwt';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { entityFolderPath } from '@/lib/documents/library';
import { captureException } from '@/lib/observability';
import type { DocumentRecord } from '@/lib/types';

const BUCKET = 'docusign-signed';
/** Prefer storage when payload exceeds this (bytes). Always try storage first in Phase 24. */
const INLINE_MAX_BYTES = 200_000;

export type SignedFileResult = {
  ok: boolean;
  library_path?: string;
  file_name?: string;
  storage_path?: string | null;
  size_bytes?: number;
  source: 'docusign' | 'local_copy' | 'skipped';
  error?: string;
};

export async function archiveSignedDocument(
  doc: DocumentRecord,
): Promise<SignedFileResult> {
  if (!doc.envelope_id) {
    return { ok: false, source: 'skipped', error: 'No envelope_id' };
  }

  const fileBase = `${doc.doc_id}-signed`;
  const libraryPath = doc.entity_id
    ? entityFolderPath(doc.entity_id, '07_Signed', `${fileBase}.pdf`)
    : `/Firm/Signed/${fileBase}.pdf`;

  try {
    if (isDocuSignConfigured() && !doc.envelope_id.startsWith('ENV-')) {
      const cfg = getDocuSignConfig()!;
      const token = await getDocuSignAccessToken(cfg);
      const url = `${cfg.basePath}/restapi/v2.1/accounts/${cfg.accountId}/envelopes/${encodeURIComponent(doc.envelope_id)}/documents/combined`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/pdf',
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          ok: false,
          source: 'docusign',
          error: `Download failed HTTP ${res.status}: ${text.slice(0, 200)}`,
        };
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return persistSignedPayload({
        envelope_id: doc.envelope_id,
        doc_id: doc.doc_id,
        entity_id: doc.entity_id,
        file_name: `${fileBase}.pdf`,
        buffer: buf,
        content_type: 'application/pdf',
        library_path: libraryPath,
        source: 'docusign',
      });
    }

    const text =
      doc.merged_body ||
      `${doc.title}\n\nSigned envelope ${doc.envelope_id}\nCompleted ${doc.completed_at ?? new Date().toISOString()}`;
    const buf = Buffer.from(text, 'utf8');
    const textPath = libraryPath.replace(/\.pdf$/i, '.txt');
    return persistSignedPayload({
      envelope_id: doc.envelope_id,
      doc_id: doc.doc_id,
      entity_id: doc.entity_id,
      file_name: `${fileBase}.txt`,
      buffer: buf,
      content_type: 'text/plain',
      library_path: textPath,
      source: 'local_copy',
    });
  } catch (e) {
    captureException(e, { route: 'docusign/signed-archive' });
    return {
      ok: false,
      source: 'skipped',
      error: e instanceof Error ? e.message : 'archive failed',
    };
  }
}

async function uploadToStorage(
  path: string,
  buffer: Buffer,
  contentType: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const { error } = await sb.storage.from(BUCKET).upload(path, buffer, {
      contentType,
      upsert: true,
    });
    if (error) {
      return {
        ok: false,
        error: error.message.includes('Bucket not found')
          ? 'Bucket docusign-signed missing — apply phase24_maturation.sql'
          : error.message,
      };
    }
    return { ok: true, path };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'storage upload failed',
    };
  }
}

async function persistSignedPayload(input: {
  envelope_id: string;
  doc_id: string;
  entity_id: string | null;
  file_name: string;
  buffer: Buffer;
  content_type: string;
  library_path: string;
  source: string;
}): Promise<SignedFileResult> {
  const size = input.buffer.byteLength;
  const storageKey = `${input.entity_id ?? 'firm'}/${input.envelope_id}/${input.file_name}`;
  const uploaded = await uploadToStorage(
    storageKey,
    input.buffer,
    input.content_type,
  );

  // Prefer object storage; keep small/fallback inline copy when upload fails or tiny
  const contentBase64 =
    !uploaded.ok || size <= INLINE_MAX_BYTES
      ? input.buffer.toString('base64')
      : null;

  const sb = await createPersistClient();
  const { error } = await sb.from('os_docusign_signed_files').insert({
    envelope_id: input.envelope_id,
    doc_id: input.doc_id,
    entity_id: input.entity_id,
    file_name: input.file_name,
    content_base64: contentBase64,
    content_type: input.content_type,
    library_path: input.library_path,
    source: input.source,
    storage_path: uploaded.ok ? uploaded.path : null,
    size_bytes: size,
    storage_error: uploaded.ok ? null : uploaded.error,
  });

  if (error) {
    console.error('[docusign] signed file insert failed', error.message);
    return {
      ok: false,
      source: input.source as SignedFileResult['source'],
      error: error.message,
      size_bytes: size,
    };
  }

  return {
    ok: true,
    library_path: input.library_path,
    file_name: input.file_name,
    storage_path: uploaded.ok ? uploaded.path : null,
    size_bytes: size,
    source: input.source as SignedFileResult['source'],
    error: uploaded.ok ? undefined : uploaded.error,
  };
}

export async function getSignedFileDownloadUrl(
  storagePath: string,
  expiresIn = 3600,
): Promise<string | null> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, expiresIn);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

export type SignedFileRow = {
  id: string;
  envelope_id: string;
  doc_id: string | null;
  entity_id: string | null;
  file_name: string;
  content_type: string | null;
  library_path: string | null;
  source: string;
  storage_path: string | null;
  size_bytes: number | null;
  storage_error: string | null;
  received_at: string;
  download_url?: string | null;
};

export async function listSignedFiles(opts?: {
  limit?: number;
  envelopeId?: string;
  withDownloadUrls?: boolean;
}): Promise<{ rows: SignedFileRow[]; error?: string }> {
  try {
    const sb = await createPersistClient();
    let q = sb
      .from('os_docusign_signed_files')
      .select(
        'id, envelope_id, doc_id, entity_id, file_name, content_type, library_path, source, storage_path, size_bytes, storage_error, received_at',
      )
      .order('received_at', { ascending: false })
      .limit(opts?.limit ?? 20);
    if (opts?.envelopeId) q = q.eq('envelope_id', opts.envelopeId);
    const { data, error } = await q;
    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []) as SignedFileRow[];
    if (!opts?.withDownloadUrls) return { rows };

    const enriched = await Promise.all(
      rows.map(async (row) => {
        if (!row.storage_path) return { ...row, download_url: null };
        const download_url = await getSignedFileDownloadUrl(row.storage_path);
        return { ...row, download_url };
      }),
    );
    return { rows: enriched };
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message : 'list failed',
    };
  }
}
