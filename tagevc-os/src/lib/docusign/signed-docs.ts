/**
 * Fetch completed DocuSign envelope documents into 07_Signed archive (Phase 23).
 */

import { getDocuSignConfig, isDocuSignConfigured } from '@/lib/docusign/config';
import { getDocuSignAccessToken } from '@/lib/docusign/jwt';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { entityFolderPath } from '@/lib/documents/library';
import type { DocumentRecord } from '@/lib/types';

export type SignedFileResult = {
  ok: boolean;
  library_path?: string;
  file_name?: string;
  source: 'docusign' | 'local_copy' | 'skipped';
  error?: string;
};

/**
 * On envelope completed: download combined PDF when live DocuSign configured;
 * otherwise archive merged_body as text into os_docusign_signed_files.
 */
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
      const contentBase64 = buf.toString('base64');
      await persistSignedFile({
        envelope_id: doc.envelope_id,
        doc_id: doc.doc_id,
        entity_id: doc.entity_id,
        file_name: `${fileBase}.pdf`,
        content_base64: contentBase64,
        content_type: 'application/pdf',
        library_path: libraryPath,
        source: 'docusign',
      });
      return {
        ok: true,
        library_path: libraryPath,
        file_name: `${fileBase}.pdf`,
        source: 'docusign',
      };
    }

    // Mock / local: archive text body
    const text =
      doc.merged_body ||
      `${doc.title}\n\nSigned envelope ${doc.envelope_id}\nCompleted ${doc.completed_at ?? new Date().toISOString()}`;
    const contentBase64 = Buffer.from(text, 'utf8').toString('base64');
    const textPath = libraryPath.replace(/\.pdf$/i, '.txt');
    await persistSignedFile({
      envelope_id: doc.envelope_id,
      doc_id: doc.doc_id,
      entity_id: doc.entity_id,
      file_name: `${fileBase}.txt`,
      content_base64: contentBase64,
      content_type: 'text/plain',
      library_path: textPath,
      source: 'local_copy',
    });
    return {
      ok: true,
      library_path: textPath,
      file_name: `${fileBase}.txt`,
      source: 'local_copy',
    };
  } catch (e) {
    return {
      ok: false,
      source: 'skipped',
      error: e instanceof Error ? e.message : 'archive failed',
    };
  }
}

async function persistSignedFile(row: {
  envelope_id: string;
  doc_id: string;
  entity_id: string | null;
  file_name: string;
  content_base64: string;
  content_type: string;
  library_path: string;
  source: string;
}) {
  const sb = await createPersistClient();
  const { error } = await sb.from('os_docusign_signed_files').insert(row);
  if (error) {
    console.error('[docusign] signed file insert failed', error.message);
    throw new Error(error.message);
  }
}

export async function listSignedFiles(opts?: {
  limit?: number;
  envelopeId?: string;
}) {
  try {
    const sb = await createPersistClient();
    let q = sb
      .from('os_docusign_signed_files')
      .select(
        'id, envelope_id, doc_id, entity_id, file_name, content_type, library_path, source, received_at',
      )
      .order('received_at', { ascending: false })
      .limit(opts?.limit ?? 20);
    if (opts?.envelopeId) q = q.eq('envelope_id', opts.envelopeId);
    const { data, error } = await q;
    if (error) return { rows: [], error: error.message };
    return { rows: data ?? [] };
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message : 'list failed',
    };
  }
}
