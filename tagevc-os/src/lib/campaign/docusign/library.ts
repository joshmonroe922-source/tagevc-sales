/**
 * Document Library listing for ECC DocuSign journey nodes.
 * Library remains SoT — campaign only stores library_document_id refs.
 */

import { listDocuments, getDocument } from '@/lib/data/document-store';
import { campaignDb } from '@/lib/campaign/db/client';

export async function listLibraryDocumentsForEntity(
  entityId: string,
  q?: string,
): Promise<Array<{ id: string; title: string; folder?: string }>> {
  // Prefer ECC refs table when populated
  try {
    const sb = await campaignDb();
    const { data } = await sb
      .from('ecc_library_document_refs')
      .select('library_document_id, title')
      .eq('entity_id', entityId)
      .limit(100);
    if (data?.length) {
      return data
        .map((r) => ({
          id: String(r.library_document_id),
          title: String(r.title || r.library_document_id),
        }))
        .filter((d) =>
          q ? d.title.toLowerCase().includes(q.toLowerCase()) : true,
        );
    }
  } catch {
    // table may not exist yet
  }

  const docs = listDocuments(entityId);
  return docs
    .filter((d) =>
      q
        ? `${d.title} ${d.doc_id}`.toLowerCase().includes(q.toLowerCase())
        : true,
    )
    .slice(0, 50)
    .map((d) => ({ id: d.doc_id, title: d.title || d.doc_id, folder: d.folder }));
}

export function getLibraryDocumentContent(docId: string): {
  title: string;
  content: string;
} | null {
  const doc = getDocument(docId);
  if (!doc) return null;
  return {
    title: doc.title || docId,
    content: doc.merged_body || doc.title || docId,
  };
}
