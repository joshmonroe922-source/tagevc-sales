/**
 * Persist attach target on library doc meta at send time; apply on Connect completed.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  attachSignedDocumentToRecord,
  type AttachTargetKind,
} from '@/lib/docusign/attach';

export type LibraryAttachTarget = {
  kind: AttachTargetKind;
  recordId: string;
};

export async function stashLibraryAttachTarget(input: {
  docId: string;
  envelopeId?: string | null;
  attach: LibraryAttachTarget | null | undefined;
}): Promise<void> {
  if (!input.attach?.recordId || !input.attach.kind) return;
  try {
    const sb = await createPersistClient();
    const { data: doc } = await sb
      .from('documents')
      .select('meta')
      .eq('doc_id', input.docId)
      .maybeSingle();
    const prev =
      doc?.meta && typeof doc.meta === 'object'
        ? (doc.meta as Record<string, unknown>)
        : {};
    await sb
      .from('documents')
      .update({
        meta: {
          ...prev,
          docusign_attach: {
            kind: input.attach.kind,
            record_id: input.attach.recordId,
            envelope_id: input.envelopeId ?? null,
            stashed_at: new Date().toISOString(),
          },
        },
      })
      .eq('doc_id', input.docId);
  } catch {
    /* soft */
  }
}

export async function applyStashedLibraryAttach(input: {
  docId: string;
  envelopeId?: string | null;
}): Promise<
  | { ok: true; applied: boolean; detail?: string }
  | { ok: false; error: string }
> {
  try {
    const sb = await createPersistClient();
    const { data: doc } = await sb
      .from('documents')
      .select('meta, entity_id')
      .eq('doc_id', input.docId)
      .maybeSingle();
    const meta =
      doc?.meta && typeof doc.meta === 'object'
        ? (doc.meta as Record<string, unknown>)
        : {};
    const stash = meta.docusign_attach as
      | { kind?: string; record_id?: string }
      | undefined;
    if (!stash?.kind || !stash.record_id) {
      return { ok: true, applied: false, detail: 'no_attach_target' };
    }

    const result = await attachSignedDocumentToRecord({
      kind: stash.kind as AttachTargetKind,
      recordId: stash.record_id,
      documentId: input.docId,
      envelopeId: input.envelopeId ?? null,
      entityId: doc?.entity_id ? String(doc.entity_id) : null,
    });

    if (!result.ok) return { ok: false, error: result.error };

    await sb
      .from('documents')
      .update({
        meta: {
          ...meta,
          docusign_attach: {
            ...stash,
            applied_at: new Date().toISOString(),
            envelope_id: input.envelopeId ?? null,
          },
        },
      })
      .eq('doc_id', input.docId);

    return { ok: true, applied: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'attach_apply_failed',
    };
  }
}
