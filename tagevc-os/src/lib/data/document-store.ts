import { createHash, randomUUID } from 'crypto';
import { SEED_ENTITIES } from '@/lib/data/seed';
import { listActiveDeals } from '@/lib/data/deal-flow-store';
import {
  applyAiReviewToDocument,
  spawnTicketForSuggestion,
} from '@/lib/documents/ai-actions';
import { assertHumanCanSend, isCapitalDocument } from '@/lib/documents/capital-gate';
import {
  entityFolderPath,
  sanitizeFileName,
} from '@/lib/documents/library';
import {
  applyMerge,
  buildMergeValues,
  DOC_TEMPLATES,
  getTemplate,
} from '@/lib/documents/templates';
import type {
  AiSuggestionStatus,
  DocAuditEvent,
  DocStatus,
  DocumentRecord,
  EntityDocFolder,
} from '@/lib/types';
import { ENTITY_DOC_FOLDERS } from '@/lib/types/enums';

type DocStore = {
  docs: DocumentRecord[];
  audits: DocAuditEvent[];
};

declare global {
  var __tageDocStore: DocStore | undefined;
}

const COI_SEED_BODY = `Certificate of Insurance — Instant NDA
Carrier: Sample Mutual Insurance Co.
Policy Type: General Liability + Workers Comp
Named Insured: Instant NDA, Inc.
Coverage limits: $2,000,000 aggregate
Expiration: 2026-09-30
Renewal: 2026-09-01
Certificate holder must receive 30 days notice prior to cancellation.
Insured shall maintain continuous coverage and must provide updated COI upon renewal.`;

function createStore(): DocStore {
  const now = new Date().toISOString();
  const entity = SEED_ENTITIES.find((e) => e.entity_id === 'ENT-002')!;
  const values = buildMergeValues({
    entity,
    deal: {
      id: '00000000-0000-4000-8000-000000000001',
      deal_id: 'DE-LAU-01',
      lead_id: null,
      company_name: entity.canonical_name,
      entity_id: entity.entity_id,
      exec_stage: 'Term Sheet',
      priority: 'Critical',
      instrument: 'Priced Equity',
      premoney_m: 28,
      check_k: 2500,
      ownership_pct: 0.1,
      counsel: 'Firm Counsel',
      path: 'Launch',
      outcome: null,
      owner: 'Partner',
      next_action: null,
      handoff_id: null,
      created_at: now,
      updated_at: now,
      archived_at: null,
    },
    party: {
      signatory_name: 'Alex Founder',
      signatory_email: 'alex@instantnda.example',
    },
  });
  const tpl = getTemplate('TPL-NDA')!;
  const seedNda: DocumentRecord = {
    id: '88888888-8888-4888-8888-888888888801',
    doc_id: 'DOC-001',
    entity_id: 'ENT-002',
    deal_or_task_id: null,
    doc_type: 'NDA',
    template_id: 'TPL-NDA',
    title: 'Mutual NDA — Instant NDA',
    library_path: entityFolderPath(
      'ENT-002',
      '02_Deal',
      'DOC-001_Mutual_NDA.txt',
    ),
    folder: '02_Deal',
    status: 'Completed',
    envelope_id: 'ENV-SEED-NDA',
    merged_body: applyMerge(tpl.body, values),
    merge_values: values,
    signers: [
      {
        name: 'Alex Founder',
        email: 'alex@instantnda.example',
        order: 1,
        role: 'Company',
      },
    ],
    sent_by: 'Counsel',
    sent_at: now,
    completed_at: now,
    content_hash: 'seedhash',
    notes: 'Seed completed NDA in library',
    ai_review: null,
    created_at: now,
    updated_at: now,
  };

  const seedCoi: DocumentRecord = {
    id: '88888888-8888-4888-8888-888888888802',
    doc_id: 'DOC-002',
    entity_id: 'ENT-002',
    deal_or_task_id: null,
    doc_type: 'Other',
    template_id: null,
    title: 'Certificate of Insurance — Instant NDA',
    library_path: entityFolderPath(
      'ENT-002',
      '01_Corporate',
      'DOC-002_Certificate_of_Insurance.txt',
    ),
    folder: '01_Corporate',
    status: 'Completed',
    envelope_id: null,
    merged_body: COI_SEED_BODY,
    merge_values: {},
    signers: [],
    sent_by: null,
    sent_at: null,
    completed_at: now,
    content_hash: createHash('sha256').update(COI_SEED_BODY).digest('hex').slice(0, 16),
    notes: 'Seed COI for Phase 4.5 AI demo (expiration language)',
    ai_review: null,
    created_at: now,
    updated_at: now,
  };

  const store: DocStore = {
    docs: [seedNda, seedCoi],
    audits: [
      {
        id: '99999999-9999-4999-8999-999999999901',
        event_id: 'DEVT-001',
        doc_id: 'DOC-001',
        action: 'completed',
        actor: 'system',
        detail: 'Seed document',
        created_at: now,
      },
      {
        id: '99999999-9999-4999-8999-999999999902',
        event_id: 'DEVT-002',
        doc_id: 'DOC-002',
        action: 'uploaded',
        actor: 'system',
        detail: 'Seed COI for AI document intelligence demo',
        created_at: now,
      },
    ],
  };

  // Demo: run heuristic review on COI so Shared Services shows AI tickets
  const { auditDetail } = applyAiReviewToDocument(seedCoi);
  audit(store, seedCoi.doc_id, 'ai_review', 'ai', auditDetail);

  return store;
}

export function getDocStore(): DocStore {
  if (!globalThis.__tageDocStore) {
    globalThis.__tageDocStore = createStore();
  }
  return globalThis.__tageDocStore;
}

function nextDocId(docs: DocumentRecord[]): string {
  const max = docs.reduce((m, d) => {
    const n = Number(d.doc_id.replace(/\D/g, ''));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `DOC-${String(max + 1).padStart(3, '0')}`;
}

function nextEventId(audits: DocAuditEvent[]): string {
  const max = audits.reduce((m, a) => {
    const n = Number(a.event_id.replace(/\D/g, ''));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `DEVT-${String(max + 1).padStart(3, '0')}`;
}

function audit(
  store: DocStore,
  docId: string,
  action: string,
  actor: DocAuditEvent['actor'],
  detail: string,
) {
  store.audits.push({
    id: randomUUID(),
    event_id: nextEventId(store.audits),
    doc_id: docId,
    action,
    actor,
    detail,
    created_at: new Date().toISOString(),
  });
}

export function listTemplates() {
  return DOC_TEMPLATES;
}

export function listDocuments(entityId?: string): DocumentRecord[] {
  const docs = getDocStore().docs;
  const filtered = entityId
    ? docs.filter((d) => d.entity_id === entityId)
    : docs;
  return [...filtered].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function getDocument(docId: string): DocumentRecord | null {
  return getDocStore().docs.find((d) => d.doc_id === docId) ?? null;
}

export function listDocAudits(docId: string): DocAuditEvent[] {
  return getDocStore()
    .audits.filter((a) => a.doc_id === docId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function documentsByFolder(entityId: string) {
  const docs = listDocuments(entityId);
  const map: Record<string, DocumentRecord[]> = {};
  for (const f of ENTITY_DOC_FOLDERS) map[f] = [];
  map.Other = [];
  for (const d of docs) {
    if (map[d.folder]) map[d.folder].push(d);
    else map.Other.push(d);
  }
  return map;
}

export type CreateFromTemplateInput = {
  template_id: string;
  entity_id: string;
  deal_id?: string;
  signatory_name?: string;
  signatory_email?: string;
  notes?: string;
};

/** §4 steps 1–3: select template, merge fields, route signers → Draft / Ready to Send. */
export function createDocumentFromTemplate(
  input: CreateFromTemplateInput,
): DocumentRecord {
  const store = getDocStore();
  const tpl = getTemplate(input.template_id);
  if (!tpl) throw new Error('Unknown template');
  const entity = SEED_ENTITIES.find((e) => e.entity_id === input.entity_id);
  if (!entity) throw new Error('Unknown entity');

  const deal =
    listActiveDeals().find((d) => d.deal_id === input.deal_id) ??
    listActiveDeals().find((d) => d.company_name === entity.canonical_name) ??
    null;

  const values = buildMergeValues({
    entity,
    deal,
    party: {
      signatory_name: input.signatory_name ?? 'Signatory',
      signatory_email: input.signatory_email ?? 'signatory@example.com',
    },
  });
  const merged = applyMerge(tpl.body, values);
  const folder = (
    tpl.folder_hint === 'Templates' ? '02_Deal' : tpl.folder_hint
  ) as EntityDocFolder;
  const docId = nextDocId(store.docs);
  const file = sanitizeFileName(`${docId}_${tpl.name}.txt`);
  const now = new Date().toISOString();

  const doc: DocumentRecord = {
    id: randomUUID(),
    doc_id: docId,
    entity_id: entity.entity_id,
    deal_or_task_id: deal?.deal_id ?? input.deal_id ?? null,
    doc_type: tpl.doc_type,
    template_id: tpl.template_id,
    title: `${tpl.name} — ${entity.canonical_name}`,
    library_path: entityFolderPath(entity.entity_id, folder, file),
    folder,
    status: 'Ready to Send',
    envelope_id: null,
    merged_body: merged,
    merge_values: values,
    signers: [
      {
        name: input.signatory_name ?? 'Signatory',
        email: input.signatory_email ?? 'signatory@example.com',
        order: 1,
        role: 'Counterparty',
      },
      {
        name: 'Tage Counsel',
        email: 'counsel@tagevc.com',
        order: 2,
        role: 'Firm',
      },
    ],
    sent_by: null,
    sent_at: null,
    completed_at: null,
    content_hash: createHash('sha256').update(merged).digest('hex').slice(0, 16),
    notes: input.notes ?? null,
    ai_review: null,
    created_at: now,
    updated_at: now,
  };
  store.docs.push(doc);
  audit(
    store,
    doc.doc_id,
    'created_from_template',
    'human',
    `template=${tpl.template_id}; capital=${isCapitalDocument(tpl.doc_type)}`,
  );
  return runAiReviewOnDocument(doc.doc_id);
}

export type UploadDocumentInput = {
  entity_id: string;
  folder: EntityDocFolder;
  title: string;
  doc_type?: DocumentRecord['doc_type'];
  notes?: string;
  content?: string;
};

/** Simple organize/upload into entity folder (content stored as text stub). */
export function uploadDocument(input: UploadDocumentInput): DocumentRecord {
  const store = getDocStore();
  const entity = SEED_ENTITIES.find((e) => e.entity_id === input.entity_id);
  if (!entity) throw new Error('Unknown entity');
  const docId = nextDocId(store.docs);
  const file = sanitizeFileName(`${docId}_${input.title}.txt`);
  const now = new Date().toISOString();
  const body = input.content?.trim() || `(Uploaded) ${input.title}`;
  const doc: DocumentRecord = {
    id: randomUUID(),
    doc_id: docId,
    entity_id: entity.entity_id,
    deal_or_task_id: null,
    doc_type: input.doc_type ?? 'Other',
    template_id: null,
    title: input.title.trim(),
    library_path: entityFolderPath(entity.entity_id, input.folder, file),
    folder: input.folder,
    status: 'Draft',
    envelope_id: null,
    merged_body: body,
    merge_values: {},
    signers: [],
    sent_by: null,
    sent_at: null,
    completed_at: null,
    content_hash: createHash('sha256').update(body).digest('hex').slice(0, 16),
    notes: input.notes ?? null,
    ai_review: null,
    created_at: now,
    updated_at: now,
  };
  store.docs.push(doc);
  audit(store, doc.doc_id, 'uploaded', 'human', `folder=${input.folder}`);
  return runAiReviewOnDocument(doc.doc_id);
}

/**
 * Phase 4.5 — run (or re-run) document intelligence and spawn SS tickets.
 * Re-runs are allowed for demos; prior suggestion tickets are not deleted.
 */
export function runAiReviewOnDocument(docId: string): DocumentRecord {
  const store = getDocStore();
  const doc = store.docs.find((d) => d.doc_id === docId);
  if (!doc) throw new Error('Document not found');
  const { auditDetail } = applyAiReviewToDocument(doc);
  audit(store, doc.doc_id, 'ai_review', 'ai', auditDetail);
  return doc;
}

export type UpdateAiSuggestionInput = {
  status: Extract<AiSuggestionStatus, 'accepted' | 'dismissed' | 'edited'>;
  title?: string;
  description?: string;
  due_date?: string | null;
};

/**
 * Human review of an AI suggestion on the document page.
 * - accepted: ensure a ticket exists, mark accepted
 * - dismissed: mark dismissed (linked ticket left for human to close)
 * - edited: update fields, status edited (still awaiting accept unless same action)
 */
export function updateAiSuggestion(
  docId: string,
  suggestionId: string,
  patch: UpdateAiSuggestionInput,
): DocumentRecord {
  const store = getDocStore();
  const doc = store.docs.find((d) => d.doc_id === docId);
  if (!doc?.ai_review) throw new Error('Document has no AI review');
  const suggestion = doc.ai_review.suggestions.find(
    (s) => s.suggestion_id === suggestionId,
  );
  if (!suggestion) throw new Error('Suggestion not found');

  if (patch.title !== undefined) suggestion.title = patch.title.trim();
  if (patch.description !== undefined) {
    suggestion.description = patch.description.trim();
  }
  if (patch.due_date !== undefined) suggestion.due_date = patch.due_date;

  const ts = new Date().toISOString();

  if (patch.status === 'edited') {
    suggestion.status = 'edited';
    suggestion.resolved_at = null;
    doc.updated_at = ts;
    audit(
      store,
      doc.doc_id,
      'ai_suggestion_edited',
      'human',
      `suggestion=${suggestionId}`,
    );
    return doc;
  }

  if (patch.status === 'accepted') {
    spawnTicketForSuggestion(doc, suggestion);
    suggestion.status = 'accepted';
    suggestion.resolved_at = ts;
    doc.updated_at = ts;
    audit(
      store,
      doc.doc_id,
      'ai_suggestion_accepted',
      'human',
      `suggestion=${suggestionId}; ticket=${suggestion.ticket_id}`,
    );
    return doc;
  }

  // dismissed
  suggestion.status = 'dismissed';
  suggestion.resolved_at = ts;
  doc.updated_at = ts;
  audit(
    store,
    doc.doc_id,
    'ai_suggestion_dismissed',
    'human',
    `suggestion=${suggestionId}; ticket=${suggestion.ticket_id ?? 'none'}`,
  );
  return doc;
}

/**
 * §4 step 4 — Send DocuSign.
 * Capital docs require explicitHumanSend + sentBy (human gate).
 */
export function sendDocument(args: {
  doc_id: string;
  sent_by: string;
  explicit_human_send: boolean;
}): DocumentRecord {
  const store = getDocStore();
  const doc = store.docs.find((d) => d.doc_id === args.doc_id);
  if (!doc) throw new Error('Document not found');
  if (doc.status !== 'Ready to Send' && doc.status !== 'Draft') {
    throw new Error(`Cannot send from status ${doc.status}`);
  }
  assertHumanCanSend({
    docType: doc.doc_type,
    sentBy: args.sent_by,
    explicitHumanSend: args.explicit_human_send,
  });

  const now = new Date().toISOString();
  doc.envelope_id = `ENV-${doc.doc_id}-${Date.now().toString(36)}`;
  doc.status = 'Sent';
  doc.sent_by = args.sent_by.trim();
  doc.sent_at = now;
  doc.updated_at = now;
  audit(
    store,
    doc.doc_id,
    'docusign_send',
    'human',
    `envelope=${doc.envelope_id}; capital=${isCapitalDocument(doc.doc_type)}`,
  );
  return doc;
}

/** §4 step 5 — webhook status updates. */
export function applyDocuSignWebhook(args: {
  envelope_id: string;
  status: 'sent' | 'delivered' | 'signed' | 'completed' | 'declined' | 'voided';
}): DocumentRecord {
  const store = getDocStore();
  const doc = store.docs.find((d) => d.envelope_id === args.envelope_id);
  if (!doc) throw new Error('Envelope not found');

  const map: Record<string, DocStatus> = {
    sent: 'Sent',
    delivered: 'Delivered',
    signed: 'Signed',
    completed: 'Completed',
    declined: 'Declined',
    voided: 'Voided',
  };
  const next = map[args.status];
  const now = new Date().toISOString();
  doc.status = next;
  doc.updated_at = now;

  if (args.status === 'completed') {
    doc.completed_at = now;
    // Move library path marker into 07_Signed
    if (doc.entity_id) {
      const file = doc.library_path.split('/').pop() ?? `${doc.doc_id}.txt`;
      doc.folder = '07_Signed';
      doc.library_path = entityFolderPath(doc.entity_id, '07_Signed', file);
    }
  }

  audit(
    store,
    doc.doc_id,
    `webhook_${args.status}`,
    'webhook',
    `envelope=${doc.envelope_id}`,
  );
  return doc;
}

/** Dev helper: advance envelope through happy path. */
export function simulateDocuSignProgress(docId: string): DocumentRecord {
  const doc = getDocument(docId);
  if (!doc?.envelope_id) throw new Error('Document not sent');
  const order = ['delivered', 'signed', 'completed'] as const;
  let current = doc;
  for (const s of order) {
    if (
      current.status === 'Completed' ||
      current.status === 'Declined' ||
      current.status === 'Voided'
    ) {
      break;
    }
    current = applyDocuSignWebhook({
      envelope_id: doc.envelope_id,
      status: s,
    });
  }
  return current;
}
