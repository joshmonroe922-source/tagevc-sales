import { randomUUID } from 'crypto';
import type {
  DocumentAiReview,
  DocumentAiSuggestion,
  DocType,
  SsService,
  TicketPriority,
} from '@/lib/types';

export type AnalyzeDocumentInput = {
  doc_id: string;
  title: string;
  doc_type: DocType;
  folder: string;
  content: string;
  entity_id: string | null;
};

/**
 * Document intelligence engine (Phase 4.5).
 * heuristic_v1 extracts dates/obligations from text + doc-type rules.
 * Swap `analyzeDocument` implementation for LLM later without changing callers.
 */
export function analyzeDocument(input: AnalyzeDocumentInput): DocumentAiReview {
  const text = `${input.title}\n${input.content}`;
  const expiration = extractDate(text, [
    /expir(?:es|ation|y)[:\s]+(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /valid\s+until[:\s]+(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /end(?:s|ing)?\s+(?:on\s+)?(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  ]);
  const renewal = extractDate(text, [
    /renew(?:al)?[:\s]+(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /renew(?:s|al)?\s+(?:on|by)[:\s]+(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  ]);

  const suggestions: DocumentAiSuggestion[] = [];
  const now = new Date().toISOString();

  if (expiration) {
    const due = daysBefore(expiration, 30);
    suggestions.push({
      suggestion_id: `AIS-${randomUUID().slice(0, 8)}`,
      kind: 'expiration_followup',
      title: `Document expires ${expiration} — review / renew`,
      description: `AI detected an expiration date of ${expiration} on "${input.title}". Confirm renewal or replacement 30 days prior.`,
      due_date: due,
      service: serviceForDoc(input.doc_type, input.folder),
      priority: priorityForUrgency(expiration),
      status: 'pending',
      ticket_id: null,
      created_at: now,
      resolved_at: null,
    });
  }

  if (renewal) {
    suggestions.push({
      suggestion_id: `AIS-${randomUUID().slice(0, 8)}`,
      kind: 'renewal',
      title: `Renewal action by ${renewal}`,
      description: `AI detected a renewal date of ${renewal} on "${input.title}".`,
      due_date: renewal,
      service: serviceForDoc(input.doc_type, input.folder),
      priority: priorityForUrgency(renewal),
      status: 'pending',
      ticket_id: null,
      created_at: now,
      resolved_at: null,
    });
  }

  // Doc-type / folder heuristics for missing companions
  for (const missing of missingDocSuggestions(input)) {
    suggestions.push({
      suggestion_id: `AIS-${randomUUID().slice(0, 8)}`,
      ...missing,
      status: 'pending',
      ticket_id: null,
      created_at: now,
      resolved_at: null,
    });
  }

  // Obligation keywords
  if (
    /\b(shall|must|required to|obligation|notice period|within \d+ days)\b/i.test(
      text,
    )
  ) {
    suggestions.push({
      suggestion_id: `AIS-${randomUUID().slice(0, 8)}`,
      kind: 'obligation',
      title: 'Review time-sensitive obligations in document',
      description: `AI flagged obligation / notice language in "${input.title}". Confirm owners and calendar the deadlines.`,
      due_date: daysFromNow(14),
      service: serviceForDoc(input.doc_type, input.folder),
      priority: 'P2',
      status: 'pending',
      ticket_id: null,
      created_at: now,
      resolved_at: null,
    });
  }

  // Insurance / compliance folder defaults
  if (
    /insurance|certificate of insurance|coi|workers.?comp/i.test(text) ||
    input.folder === '01_Corporate'
  ) {
    if (!expiration && /insurance|coi/i.test(text)) {
      suggestions.push({
        suggestion_id: `AIS-${randomUUID().slice(0, 8)}`,
        kind: 'expiration_followup',
        title: 'Confirm insurance certificate expiration',
        description:
          'Insurance-related document uploaded without a clear expiration date. Confirm expiry and set a renewal reminder.',
        due_date: daysFromNow(7),
        service: 'Legal',
        priority: 'P2',
        status: 'pending',
        ticket_id: null,
        created_at: now,
        resolved_at: null,
      });
    }
  }

  const confidence =
    55 +
    (expiration || renewal ? 20 : 0) +
    Math.min(15, suggestions.length * 5) +
    (text.length > 120 ? 10 : 0);

  const summaryParts = [
    `Reviewed ${input.doc_type} "${input.title}".`,
    expiration ? `Expiration ${expiration}.` : null,
    renewal ? `Renewal ${renewal}.` : null,
    suggestions.length
      ? `${suggestions.length} follow-up suggestion(s).`
      : 'No automated follow-ups detected.',
  ].filter(Boolean);

  return {
    reviewed_at: now,
    engine: 'heuristic_v1',
    summary: summaryParts.join(' '),
    expiration_date: expiration,
    renewal_date: renewal,
    time_sensitive: Boolean(
      expiration ||
        renewal ||
        suggestions.some((s) => s.kind === 'obligation'),
    ),
    confidence: Math.min(95, confidence),
    suggestions,
  };
}

function missingDocSuggestions(
  input: AnalyzeDocumentInput,
): Omit<
  DocumentAiSuggestion,
  'suggestion_id' | 'status' | 'ticket_id' | 'created_at' | 'resolved_at'
>[] {
  const out: Omit<
    DocumentAiSuggestion,
    'suggestion_id' | 'status' | 'ticket_id' | 'created_at' | 'resolved_at'
  >[] = [];

  if (input.doc_type === 'Term Sheet') {
    out.push({
      kind: 'missing_document',
      title: 'Request SPA / investment agreement package',
      description:
        'Term Sheet uploaded — AI suggests tracking SPA/IRA package before Signing Ready.',
      due_date: daysFromNow(21),
      service: 'Legal',
      priority: 'P1',
    });
  }
  if (input.doc_type === 'Offer Letter' || input.folder === '05_HR') {
    out.push({
      kind: 'missing_document',
      title: 'Confirm PIIA / handbook acknowledgment on file',
      description:
        'Employment document uploaded — verify companion PIIA / handbook e-sign is complete.',
      due_date: daysFromNow(10),
      service: 'HR',
      priority: 'P2',
    });
  }
  if (input.doc_type === 'NDA' && input.folder === '02_Deal') {
    out.push({
      kind: 'other',
      title: 'Confirm NDA filed before sharing diligence materials',
      description:
        'Mutual NDA in deal folder — confirm execution before opening data room.',
      due_date: daysFromNow(3),
      service: 'Legal',
      priority: 'P2',
    });
  }
  if (/msa|master services|sow\b/i.test(`${input.title} ${input.content}`)) {
    out.push({
      kind: 'missing_document',
      title: 'Attach signed SOW / exhibits if missing',
      description:
        'Vendor/MSA language detected — ensure current SOW and exhibits are stored alongside.',
      due_date: daysFromNow(14),
      service: 'Legal',
      priority: 'P3',
    });
  }
  return out;
}

function serviceForDoc(docType: DocType, folder: string): SsService {
  if (folder === '05_HR' || docType === 'Offer Letter') return 'HR';
  if (folder === '04_Financials' || docType === 'Wire Package') return 'Finance';
  if (folder === '06_Ops') return 'IT';
  return 'Legal';
}

function priorityForUrgency(isoDate: string): TicketPriority {
  const days = (new Date(isoDate).getTime() - Date.now()) / 86400000;
  if (days <= 14) return 'P0';
  if (days <= 45) return 'P1';
  if (days <= 90) return 'P2';
  return 'P3';
}

function daysBefore(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function extractDate(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const normalized = normalizeDate(m[1]);
      if (normalized) return normalized;
    }
  }
  // ISO dates anywhere
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  return null;
}

function normalizeDate(raw: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
