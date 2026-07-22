/**
 * Fetch completed DocuSign envelope documents into 07_Signed (Phases 23–25).
 * Combined PDF + Certificate of Completion; Storage backfill for legacy inline rows.
 */

import { getDocuSignConfig, isDocuSignConfigured } from '@/lib/docusign/config';
import {
  downloadCertificateOfCompletion,
} from '@/lib/docusign/envelopes';
import { getDocuSignAccessToken } from '@/lib/docusign/jwt';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { entityFolderPath } from '@/lib/documents/library';
import { captureException } from '@/lib/observability';
import type { DocumentRecord } from '@/lib/types';
import { randomUUID } from 'crypto';
import {
  assertPdfPayload,
  describeArchiveBytes,
  DOCUSIGN_COMBINED_ARCHIVE_MAX_BYTES,
  DOCUSIGN_CERTIFICATE_MAX_BYTES,
  readBoundedResponseBuffer,
} from '@/lib/docusign/archive-contracts';

const BUCKET = 'docusign-signed';
const INLINE_MAX_BYTES = 200_000;

export type SignedFileKind = 'combined' | 'certificate';

export type SignedFileResult = {
  ok: boolean;
  library_path?: string;
  file_name?: string;
  storage_path?: string | null;
  size_bytes?: number;
  content_sha256?: string;
  archive_manifest_id?: string;
  replayed?: boolean;
  file_kind?: SignedFileKind;
  source: 'docusign' | 'local_copy' | 'skipped';
  error?: string;
  coc?: SignedFileResult;
};

export async function archiveSignedDocument(
  doc: DocumentRecord,
  options?: { providerStatus?: string; sourceRequestId?: string },
): Promise<SignedFileResult> {
  if (!doc.envelope_id) {
    return { ok: false, source: 'skipped', error: 'No envelope_id' };
  }

  const fileBase = `${doc.doc_id}-signed`;
  const libraryPath = doc.entity_id
    ? entityFolderPath(doc.entity_id, '07_Signed', `${fileBase}.pdf`)
    : `/Firm/Signed/${fileBase}.pdf`;

  try {
    let combined: SignedFileResult;

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
        const text = (
          await readBoundedResponseBuffer(
            res,
            4096,
            'DocuSign download error',
          ).catch(() => Buffer.alloc(0))
        ).toString('utf8');
        return {
          ok: false,
          source: 'docusign',
          error: `Download failed HTTP ${res.status}: ${text.slice(0, 200)}`,
        };
      }
      const buf = await readBoundedResponseBuffer(
        res,
        DOCUSIGN_COMBINED_ARCHIVE_MAX_BYTES,
        'DocuSign combined archive',
      );
      assertPdfPayload(
        buf,
        res.headers.get('content-type'),
        'DocuSign combined archive',
      );
      combined = await persistSignedPayload({
        envelope_id: doc.envelope_id,
        doc_id: doc.doc_id,
        entity_id: doc.entity_id,
        file_name: `${fileBase}.pdf`,
        buffer: buf,
        content_type: 'application/pdf',
        library_path: libraryPath,
        source: 'docusign',
        file_kind: 'combined',
        provider_status: options?.providerStatus ?? doc.status,
        source_request_id: options?.sourceRequestId ?? randomUUID(),
      });
    } else {
      const text =
        doc.merged_body ||
        `${doc.title}\n\nSigned envelope ${doc.envelope_id}\nCompleted ${doc.completed_at ?? new Date().toISOString()}`;
      const buf = Buffer.from(text, 'utf8');
      const textPath = libraryPath.replace(/\.pdf$/i, '.txt');
      combined = await persistSignedPayload({
        envelope_id: doc.envelope_id,
        doc_id: doc.doc_id,
        entity_id: doc.entity_id,
        file_name: `${fileBase}.txt`,
        buffer: buf,
        content_type: 'text/plain',
        library_path: textPath,
        source: 'local_copy',
        file_kind: 'combined',
        provider_status: options?.providerStatus ?? doc.status,
        source_request_id: options?.sourceRequestId ?? randomUUID(),
      });
    }

    // Certificate of Completion (best-effort; does not fail the combined archive)
    const cocDl = await downloadCertificateOfCompletion(doc.envelope_id);
    let coc: SignedFileResult | undefined;
    if (cocDl.ok) {
      const cocName = `${fileBase}-coc.${
        doc.envelope_id.startsWith('ENV-') ? 'txt' : 'pdf'
      }`;
      const cocPath = doc.entity_id
        ? entityFolderPath(doc.entity_id, '07_Signed', cocName)
        : `/Firm/Signed/${cocName}`;
      coc = await persistSignedPayload({
        envelope_id: doc.envelope_id,
        doc_id: doc.doc_id,
        entity_id: doc.entity_id,
        file_name: cocName,
        buffer: cocDl.buffer,
        content_type: doc.envelope_id.startsWith('ENV-')
          ? 'text/plain'
          : 'application/pdf',
        library_path: cocPath,
        source: combined.source,
        file_kind: 'certificate',
        provider_status: options?.providerStatus ?? doc.status,
        source_request_id: `${options?.sourceRequestId ?? randomUUID()}:certificate`,
      });
    } else {
      coc = {
        ok: false,
        source: 'skipped',
        error: cocDl.error,
        file_kind: 'certificate',
      };
    }

    return { ...combined, coc };
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
      upsert: false,
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

async function storedPayloadMatches(
  path: string,
  expectedLength: number,
  expectedSha256: string,
): Promise<boolean> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.storage.from(BUCKET).download(path);
    if (error || !data || data.size !== expectedLength) return false;
    const buffer = Buffer.from(await data.arrayBuffer());
    return describeArchiveBytes(buffer).contentSha256 === expectedSha256;
  } catch {
    return false;
  }
}

export async function persistSignedPayload(input: {
  envelope_id: string;
  doc_id: string;
  entity_id: string | null;
  file_name: string;
  buffer: Buffer;
  content_type: string;
  library_path: string;
  source: string;
  file_kind?: SignedFileKind;
  provider_status: string;
  source_request_id: string;
}): Promise<SignedFileResult> {
  const size = input.buffer.byteLength;
  const kind = input.file_kind ?? 'combined';
  const maxBytes =
    kind === 'combined'
      ? DOCUSIGN_COMBINED_ARCHIVE_MAX_BYTES
      : DOCUSIGN_CERTIFICATE_MAX_BYTES;
  if (size < 1 || size > maxBytes) {
    return {
      ok: false,
      source: input.source as SignedFileResult['source'],
      error: `${kind} archive exceeds allowed byte bounds`,
      size_bytes: size,
      file_kind: kind,
    };
  }
  const { contentLength, contentSha256 } = describeArchiveBytes(input.buffer);
  const downloadedAt = new Date().toISOString();
  const sb = await createPersistClient();
  const { data: manifestData, error: manifestError } = await sb.rpc(
    'register_docusign_archive_manifest',
    {
      p_envelope_id: input.envelope_id,
      p_document_id: input.doc_id,
      p_entity_id: input.entity_id,
      p_file_kind: kind,
      p_provider_status: input.provider_status,
      p_content_length: contentLength,
      p_content_sha256: contentSha256,
      p_downloaded_at: downloadedAt,
      p_source_request_id: input.source_request_id,
      p_source: input.source,
    },
  );
  const manifest = manifestData as {
    manifest_id?: string;
    disposition?: string;
    accepted?: boolean;
  } | null;
  if (manifestError || !manifest?.manifest_id || manifest.accepted !== true) {
    return {
      ok: false,
      source: input.source as SignedFileResult['source'],
      error:
        manifestError?.message ||
        `Archive blocked: ${manifest?.disposition ?? 'manifest rejected'}`,
      size_bytes: size,
      content_sha256: contentSha256,
      file_kind: kind,
    };
  }
  if (manifest.disposition === 'replay') {
    const { data: existing } = await sb
      .from('os_docusign_signed_files')
      .select(
        'file_name, library_path, storage_path, size_bytes, content_base64',
      )
      .eq('archive_manifest_id', manifest.manifest_id)
      .maybeSingle();
    if (existing) {
      const inlineMatches =
        typeof existing.content_base64 === 'string' &&
        describeArchiveBytes(
          Buffer.from(existing.content_base64, 'base64'),
        ).contentSha256 === contentSha256;
      const storageMatches =
        typeof existing.storage_path === 'string' &&
        (await storedPayloadMatches(
          existing.storage_path,
          contentLength,
          contentSha256,
        ));
      const persistedMatches = existing.storage_path
        ? storageMatches
        : inlineMatches;
      if (!persistedMatches) {
        return {
          ok: false,
          source: input.source as SignedFileResult['source'],
          error: 'Stored archive bytes drift from immutable manifest',
          size_bytes: size,
          content_sha256: contentSha256,
          archive_manifest_id: manifest.manifest_id,
          file_kind: kind,
        };
      }
      return {
        ok: true,
        file_name: existing.file_name,
        library_path: existing.library_path,
        storage_path: existing.storage_path,
        size_bytes: existing.size_bytes,
        source: input.source as SignedFileResult['source'],
        content_sha256: contentSha256,
        archive_manifest_id: manifest.manifest_id,
        replayed: true,
        file_kind: kind,
      };
    }
  }
  const storageKey = `${input.entity_id ?? 'firm'}/${input.envelope_id}/${kind}/${input.file_name}`;
  const uploadResult = await uploadToStorage(
    storageKey,
    input.buffer,
    input.content_type,
  );
  const uploaded =
    !uploadResult.ok &&
    manifest.disposition === 'replay' &&
    /already exists|duplicate/i.test(uploadResult.error) &&
    (await storedPayloadMatches(storageKey, contentLength, contentSha256))
      ? ({ ok: true, path: storageKey } as const)
      : uploadResult;

  const contentBase64 =
    !uploaded.ok || size <= INLINE_MAX_BYTES
      ? input.buffer.toString('base64')
      : null;

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
    file_kind: kind,
    archive_manifest_id: manifest.manifest_id,
    replayed: false,
  });

  if (error) {
    console.error('[docusign] signed file insert failed', error.message);
    return {
      ok: false,
      source: input.source as SignedFileResult['source'],
      error: error.message,
      size_bytes: size,
      content_sha256: contentSha256,
      archive_manifest_id: manifest.manifest_id,
      file_kind: kind,
    };
  }

  return {
    ok: true,
    library_path: input.library_path,
    file_name: input.file_name,
    storage_path: uploaded.ok ? uploaded.path : null,
    size_bytes: size,
    content_sha256: contentSha256,
    archive_manifest_id: manifest.manifest_id,
    source: input.source as SignedFileResult['source'],
    error: uploaded.ok ? undefined : uploaded.error,
    file_kind: kind,
  };
}

/**
 * Phase 40 provider-only backfill. This path only downloads completed bytes;
 * it never creates, sends, corrects, or resends an envelope.
 */
export async function archiveProviderCompletedDocument(input: {
  envelopeId: string;
  documentId: string;
  entityId: string | null;
  providerStatus: string;
  sourceRequestId: string;
}): Promise<SignedFileResult> {
  if (
    input.envelopeId.startsWith('ENV-') ||
    !isDocuSignConfigured() ||
    !['completed', 'signed'].includes(input.providerStatus.toLowerCase())
  ) {
    return {
      ok: false,
      source: 'docusign',
      error: 'Provider archive is unavailable or envelope is not completed',
    };
  }
  const cfg = getDocuSignConfig()!;
  const fileBase = `${input.documentId}-signed`;
  const libraryPath = input.entityId
    ? entityFolderPath(input.entityId, '07_Signed', `${fileBase}.pdf`)
    : `/Firm/Signed/${fileBase}.pdf`;
  try {
    const token = await getDocuSignAccessToken(cfg);
    const url = `${cfg.basePath}/restapi/v2.1/accounts/${cfg.accountId}/envelopes/${encodeURIComponent(input.envelopeId)}/documents/combined`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/pdf' },
    });
    if (!response.ok) {
      throw new Error(`Combined archive download HTTP ${response.status}`);
    }
    const buffer = await readBoundedResponseBuffer(
      response,
      DOCUSIGN_COMBINED_ARCHIVE_MAX_BYTES,
      'DocuSign combined archive backfill',
    );
    assertPdfPayload(
      buffer,
      response.headers.get('content-type'),
      'DocuSign combined archive backfill',
    );
    const combined = await persistSignedPayload({
      envelope_id: input.envelopeId,
      doc_id: input.documentId,
      entity_id: input.entityId,
      file_name: `${fileBase}.pdf`,
      buffer,
      content_type: 'application/pdf',
      library_path: libraryPath,
      source: 'docusign',
      file_kind: 'combined',
      provider_status: input.providerStatus,
      source_request_id: input.sourceRequestId,
    });
    if (!combined.ok) return combined;

    const certificate = await downloadCertificateOfCompletion(input.envelopeId);
    const coc = certificate.ok
      ? await persistSignedPayload({
          envelope_id: input.envelopeId,
          doc_id: input.documentId,
          entity_id: input.entityId,
          file_name: `${fileBase}-coc.pdf`,
          buffer: certificate.buffer,
          content_type: 'application/pdf',
          library_path: input.entityId
            ? entityFolderPath(
                input.entityId,
                '07_Signed',
                `${fileBase}-coc.pdf`,
              )
            : `/Firm/Signed/${fileBase}-coc.pdf`,
          source: 'docusign',
          file_kind: 'certificate',
          provider_status: input.providerStatus,
          source_request_id: `${input.sourceRequestId}:certificate`,
        })
      : {
          ok: false,
          source: 'docusign' as const,
          file_kind: 'certificate' as const,
          error: certificate.error,
        };
    return { ...combined, coc };
  } catch (error) {
    return {
      ok: false,
      source: 'docusign',
      error:
        error instanceof Error
          ? error.message
          : 'Provider archive backfill failed',
    };
  }
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
  file_kind?: string | null;
  archive_manifest_id?: string | null;
  content_sha256?: string | null;
  provider_status?: string | null;
  downloaded_at?: string | null;
  source_request_id?: string | null;
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
        'id, envelope_id, doc_id, entity_id, file_name, content_type, library_path, source, storage_path, size_bytes, storage_error, file_kind, archive_manifest_id, received_at',
      )
      .order('received_at', { ascending: false })
      .limit(opts?.limit ?? 20);
    if (opts?.envelopeId) q = q.eq('envelope_id', opts.envelopeId);
    const { data, error } = await q;
    if (error) return { rows: [], error: error.message };

    const baseRows = (data ?? []) as SignedFileRow[];
    const manifestIds = baseRows
      .map((row) => row.archive_manifest_id)
      .filter((id): id is string => Boolean(id));
    const { data: manifests } =
      manifestIds.length === 0
        ? { data: [] }
        : await sb
            .from('os_docusign_archive_manifests')
            .select(
              'manifest_id, content_sha256, provider_status, downloaded_at, source_request_id',
            )
            .in('manifest_id', manifestIds);
    const manifestById = new Map(
      (manifests ?? []).map((manifest) => [
        String(manifest.manifest_id),
        manifest,
      ]),
    );
    const rows = baseRows.map((row) => ({
      ...row,
      ...(row.archive_manifest_id
        ? manifestById.get(row.archive_manifest_id)
        : undefined),
    }));
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

/**
 * Backfill legacy inline `content_base64` rows into Supabase Storage.
 * Clears base64 for large files after successful upload.
 */
export async function backfillSignedFilesToStorage(opts?: {
  limit?: number;
}): Promise<{
  processed: number;
  uploaded: number;
  failed: number;
  results: Array<{ id: string; ok: boolean; error?: string; path?: string }>;
}> {
  const limit = opts?.limit ?? 20;
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_docusign_signed_files')
    .select(
      'id, envelope_id, entity_id, file_name, content_base64, content_type, file_kind, storage_path',
    )
    .is('storage_path', null)
    .not('content_base64', 'is', null)
    .order('received_at', { ascending: true })
    .limit(limit);

  if (error) {
    return {
      processed: 0,
      uploaded: 0,
      failed: 1,
      results: [{ id: '-', ok: false, error: error.message }],
    };
  }

  const results: Array<{
    id: string;
    ok: boolean;
    error?: string;
    path?: string;
  }> = [];
  let uploaded = 0;
  let failed = 0;

  for (const row of data ?? []) {
    const id = String(row.id);
    const b64 = row.content_base64 as string;
    try {
      const buffer = Buffer.from(b64, 'base64');
      const kind = (row.file_kind as string) || 'combined';
      const storageKey = `${(row.entity_id as string) ?? 'firm'}/${row.envelope_id}/${kind}/${row.file_name}`;
      const up = await uploadToStorage(
        storageKey,
        buffer,
        (row.content_type as string) || 'application/pdf',
      );
      if (!up.ok) {
        failed += 1;
        await sb
          .from('os_docusign_signed_files')
          .update({ storage_error: up.error })
          .eq('id', id);
        results.push({ id, ok: false, error: up.error });
        continue;
      }
      const clearInline = buffer.byteLength > INLINE_MAX_BYTES;
      await sb
        .from('os_docusign_signed_files')
        .update({
          storage_path: up.path,
          size_bytes: buffer.byteLength,
          storage_error: null,
          content_base64: clearInline ? null : b64,
        })
        .eq('id', id);
      uploaded += 1;
      results.push({ id, ok: true, path: up.path });
    } catch (e) {
      failed += 1;
      results.push({
        id,
        ok: false,
        error: e instanceof Error ? e.message : 'backfill failed',
      });
    }
  }

  return {
    processed: (data ?? []).length,
    uploaded,
    failed,
    results,
  };
}
