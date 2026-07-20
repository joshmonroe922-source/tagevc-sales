'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  createDocumentFromTemplate,
  getDocument,
  runAiReviewOnDocument,
  sendDocument,
  simulateDocuSignProgress,
  updateAiSuggestion,
  uploadDocument,
} from '@/lib/data/document-store';
import { isCapitalDocument } from '@/lib/documents/capital-gate';
import { guardPermission } from '@/lib/rbac/session';
import { DOC_TYPES, ENTITY_DOC_FOLDERS } from '@/lib/types/enums';

export type DocActionResult =
  | { ok: true; docId?: string; message?: string }
  | { ok: false; error: string };

function revalidateDocs(entityId?: string | null, docId?: string) {
  revalidatePath('/documents');
  revalidatePath('/shared-services');
  revalidatePath('/activity');
  if (entityId) revalidatePath(`/documents/entities/${entityId}`);
  if (docId) revalidatePath(`/documents/${docId}`);
}

export async function createFromTemplateAction(
  _prev: DocActionResult | null,
  formData: FormData,
): Promise<DocActionResult> {
  const gate = await guardPermission('write:documents');
  if (!gate.ok) return gate;
  const schema = z.object({
    template_id: z.string().min(1),
    entity_id: z.string().min(1),
    deal_id: z.string().optional(),
    signatory_name: z.string().optional(),
    signatory_email: z.string().email().optional().or(z.literal('')),
    notes: z.string().optional(),
  });
  const parsed = schema.safeParse({
    template_id: formData.get('template_id'),
    entity_id: formData.get('entity_id'),
    deal_id: formData.get('deal_id') || undefined,
    signatory_name: formData.get('signatory_name') || undefined,
    signatory_email: formData.get('signatory_email') || undefined,
    notes: formData.get('notes') || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }
  try {
    const doc = createDocumentFromTemplate({
      ...parsed.data,
      signatory_email: parsed.data.signatory_email || undefined,
    });
    revalidateDocs(doc.entity_id, doc.doc_id);
    const n = doc.ai_review?.suggestions.length ?? 0;
    return {
      ok: true,
      docId: doc.doc_id,
      message: `${doc.doc_id} ready (${doc.doc_type})${n ? ` · AI: ${n} suggestion(s)` : ''}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function uploadDocumentAction(
  _prev: DocActionResult | null,
  formData: FormData,
): Promise<DocActionResult> {
  const gate = await guardPermission('write:documents');
  if (!gate.ok) return gate;
  const schema = z.object({
    entity_id: z.string().min(1),
    folder: z.enum(ENTITY_DOC_FOLDERS),
    title: z.string().min(1),
    doc_type: z.enum(DOC_TYPES).optional(),
    notes: z.string().optional(),
    content: z.string().optional(),
  });
  const parsed = schema.safeParse({
    entity_id: formData.get('entity_id'),
    folder: formData.get('folder'),
    title: formData.get('title'),
    doc_type: formData.get('doc_type') || undefined,
    notes: formData.get('notes') || undefined,
    content: formData.get('content') || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }
  try {
    const doc = uploadDocument(parsed.data);
    revalidateDocs(doc.entity_id, doc.doc_id);
    const n = doc.ai_review?.suggestions.length ?? 0;
    return {
      ok: true,
      docId: doc.doc_id,
      message: `Uploaded ${doc.doc_id}${n ? ` · AI: ${n} suggestion(s)` : ''}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function sendDocumentAction(
  docId: string,
  sentBy: string,
): Promise<DocActionResult> {
  const gate = await guardPermission('write:documents');
  if (!gate.ok) return gate;
  try {
    const existing = getDocument(docId);
    if (!existing) return { ok: false, error: 'Document not found' };
    if (isCapitalDocument(existing.doc_type)) {
      const capitalGate = await guardPermission('action:docusign_capital');
      if (!capitalGate.ok) return capitalGate;
    }
    const doc = sendDocument({
      doc_id: docId,
      sent_by: sentBy,
      explicit_human_send: true,
    });
    revalidateDocs(doc.entity_id, doc.doc_id);
    return {
      ok: true,
      docId: doc.doc_id,
      message: `Sent ${doc.envelope_id}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function simulateWebhookAction(
  docId: string,
): Promise<DocActionResult> {
  const gate = await guardPermission('write:documents');
  if (!gate.ok) return gate;
  try {
    const existing = getDocument(docId);
    if (!existing) return { ok: false, error: 'Document not found' };
    if (isCapitalDocument(existing.doc_type)) {
      const capitalGate = await guardPermission('action:docusign_capital');
      if (!capitalGate.ok) return capitalGate;
    }
    const doc = simulateDocuSignProgress(docId);
    revalidateDocs(doc.entity_id, doc.doc_id);
    return {
      ok: true,
      docId: doc.doc_id,
      message: `Status → ${doc.status}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function rerunAiReviewAction(
  docId: string,
): Promise<DocActionResult> {
  try {
    const doc = runAiReviewOnDocument(docId);
    revalidateDocs(doc.entity_id, doc.doc_id);
    const n = doc.ai_review?.suggestions.length ?? 0;
    return {
      ok: true,
      docId: doc.doc_id,
      message: `AI review complete · ${n} suggestion(s)`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function acceptAiSuggestionAction(
  docId: string,
  suggestionId: string,
  edits?: { title?: string; due_date?: string },
): Promise<DocActionResult> {
  try {
    const doc = updateAiSuggestion(docId, suggestionId, {
      status: 'accepted',
      title: edits?.title,
      due_date: edits?.due_date,
    });
    revalidateDocs(doc.entity_id, doc.doc_id);
    return { ok: true, docId, message: 'Suggestion accepted' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function dismissAiSuggestionAction(
  docId: string,
  suggestionId: string,
): Promise<DocActionResult> {
  try {
    const doc = updateAiSuggestion(docId, suggestionId, {
      status: 'dismissed',
    });
    revalidateDocs(doc.entity_id, doc.doc_id);
    return { ok: true, docId, message: 'Suggestion dismissed' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function editAiSuggestionAction(
  docId: string,
  suggestionId: string,
  edits: { title?: string; description?: string; due_date?: string },
): Promise<DocActionResult> {
  try {
    const doc = updateAiSuggestion(docId, suggestionId, {
      status: 'edited',
      ...edits,
    });
    revalidateDocs(doc.entity_id, doc.doc_id);
    return { ok: true, docId, message: 'Suggestion updated' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}
