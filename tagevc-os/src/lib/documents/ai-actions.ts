import { createAiDocumentTicket } from '@/lib/data/ticket-store';
import { analyzeDocument } from '@/lib/documents/ai-review';
import type { DocumentAiSuggestion, DocumentRecord } from '@/lib/types';

/**
 * Run heuristic (or future LLM) review, attach to doc, and auto-open
 * Shared Services tickets for each suggestion. Suggestion status stays
 * `pending` until a human accepts/dismisses on the document page.
 */
export function applyAiReviewToDocument(doc: DocumentRecord): {
  doc: DocumentRecord;
  auditDetail: string;
} {
  const review = analyzeDocument({
    doc_id: doc.doc_id,
    title: doc.title,
    doc_type: doc.doc_type,
    folder: doc.folder,
    content: doc.merged_body ?? '',
    entity_id: doc.entity_id,
  });

  for (const suggestion of review.suggestions) {
    spawnTicketForSuggestion(doc, suggestion);
  }

  const ts = new Date().toISOString();
  doc.ai_review = review;
  doc.updated_at = ts;

  return {
    doc,
    auditDetail: `engine=${review.engine}; suggestions=${review.suggestions.length}; confidence=${review.confidence}; time_sensitive=${review.time_sensitive}`,
  };
}

/** Create an Open AI ticket for a suggestion if none linked yet. */
export function spawnTicketForSuggestion(
  doc: DocumentRecord,
  suggestion: DocumentAiSuggestion,
): DocumentAiSuggestion {
  if (suggestion.ticket_id) return suggestion;
  const ticket = createAiDocumentTicket({
    doc_id: doc.doc_id,
    entity_id: doc.entity_id,
    suggestion,
  });
  suggestion.ticket_id = ticket.ticket_id;
  return suggestion;
}
