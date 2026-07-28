/**
 * Hard-delete all Help Desk (requester/portal) tickets for a clean start.
 * Keeps SSC checklist / HRIS / AI-document tickets on To Do List.
 *
 * Usage (from tagevc-os):
 *   node --env-file=.env.local scripts/hard-delete-help-desk-tickets.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const HELP_DESK_IDS = [
  'TK-619202607263',
  'TK-619202607262',
  'TK-619202607252',
  'SS-INDA-20260724-Y7TX',
  'SS-INDA-20260723-GR6Q',
  'SS-R619-20260723-XNY3',
  'TK-001',
  'TK-002',
  'TK-003',
  'TK-004',
  'TK-005',
];

const INDA_MIRROR_IDS = ['SS-INDA-20260723-GR6Q', 'SS-INDA-20260724-Y7TX'];

const TICKET_CONV_IDS = [
  'ba2d0158-14ee-4d7c-81a0-efaa47932f64', // SS-INDA-20260723-GR6Q
  'e10c70dc-affe-4e27-82bd-9c8381b8d6a1', // TK-619202607252
];

function isHelpDeskTicket(t) {
  const ref = (t.source_ref || '').trim() || null;
  if (ref === 'help_desk') return true;
  if (ref && ['ssc_checklist', 'hris_escalate', 'ai_document'].includes(ref)) {
    return false;
  }
  const title = (t.title || '').trim();
  if (title.startsWith('[SSC overdue]')) return false;
  if (title.startsWith('[HRIS overdue]')) return false;
  if (title.startsWith('[AI]')) return false;
  const requester = (t.requester_name || '').trim().toLowerCase();
  if (requester === 'ssc automation' || requester === 'hris cadence') {
    return false;
  }
  const links = t.links || '';
  if (links.includes('/shared-services/checklists')) return false;
  const description = t.description || '';
  if (
    description.includes(
      'Auto-escalated from Shared Services Center checklist',
    )
  ) {
    return false;
  }
  if (t.ai_generated && t.source_doc_id) return false;
  return true;
}

const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const beforeAll = await sb
  .from('os_tickets')
  .select(
    'ticket_id, title, source_ref, source_system, status, entity_id, requester_name, company_name, ai_generated, source_doc_id, links, description',
    { count: 'exact' },
  );
if (beforeAll.error) {
  console.error('fetch os_tickets', beforeAll.error.message);
  process.exit(1);
}
const beforeHd = (beforeAll.data || []).filter(isHelpDeskTicket);
console.log('=== BEFORE ===');
console.log(
  'os_tickets total=',
  beforeAll.count,
  'help_desk=',
  beforeHd.length,
);
for (const t of beforeHd) {
  console.log(' HD', t.ticket_id, t.title);
}

for (const table of ['r619_ss_tickets', 'r619_tickets', 'os_r619_tickets']) {
  const r = await sb.from(table).select('*', { count: 'exact', head: true });
  console.log(table + ':', r.error ? r.error.message : 'count=' + r.count);
}

const delAudits = await sb
  .from('os_ticket_audits')
  .delete()
  .in('ticket_id', HELP_DESK_IDS)
  .select('audit_id, ticket_id');
console.log(
  'deleted os_ticket_audits:',
  delAudits.error?.message || delAudits.data?.length,
  delAudits.data?.map((a) => a.audit_id),
);

const delLinks = await sb
  .from('os_ticket_context_links')
  .delete()
  .in('ticket_id', HELP_DESK_IDS)
  .select('link_id, ticket_id');
console.log(
  'deleted context_links:',
  delLinks.error?.message || delLinks.data?.length,
);

const now = new Date().toISOString();
const msgUp = await sb
  .from('os_messages')
  .update({ deleted_at: now })
  .in('conversation_id', TICKET_CONV_IDS)
  .is('deleted_at', null)
  .select('id');
console.log(
  'soft-deleted messages:',
  msgUp.error?.message || msgUp.data?.length,
);

const convUp = await sb
  .from('os_conversations')
  .update({ archived_at: now, updated_at: now })
  .in('id', TICKET_CONV_IDS)
  .is('archived_at', null)
  .select('id');
console.log(
  'newly archived conversations:',
  convUp.error?.message || convUp.data?.length,
  '(0 if already archived)',
);

const indaDel = await sb
  .from('inda_ss_tickets')
  .delete()
  .in('ticket_id', INDA_MIRROR_IDS)
  .select('ticket_id, title');
console.log(
  'deleted inda_ss_tickets:',
  indaDel.error?.message || indaDel.data,
);

const delTickets = await sb
  .from('os_tickets')
  .delete()
  .in('ticket_id', HELP_DESK_IDS)
  .select('ticket_id, title');
if (delTickets.error) {
  console.error('delete os_tickets failed', delTickets.error.message);
  process.exit(1);
}
console.log('deleted os_tickets:', delTickets.data?.length);
for (const t of delTickets.data || []) {
  console.log(' -', t.ticket_id, t.title);
}

const snap = await sb
  .from('os_store_snapshots')
  .select('collection, payload, version')
  .eq('collection', 'tickets')
  .limit(1);
if (!snap.error && snap.data?.[0]) {
  const payload = snap.data[0].payload;
  let changed = false;
  if (payload && typeof payload === 'object') {
    const idSet = new Set(HELP_DESK_IDS);
    if (Array.isArray(payload.tickets)) {
      const next = payload.tickets.filter((t) => !idSet.has(t.ticket_id));
      if (next.length !== payload.tickets.length) {
        payload.tickets = next;
        changed = true;
      }
    }
    if (Array.isArray(payload.audits)) {
      const next = payload.audits.filter((a) => !idSet.has(a.ticket_id));
      if (next.length !== payload.audits.length) {
        payload.audits = next;
        changed = true;
      }
    }
  }
  if (changed) {
    const up = await sb.from('os_store_snapshots').upsert({
      collection: 'tickets',
      payload,
      version: snap.data[0].version ?? 1,
      updated_at: now,
    });
    console.log('patched tickets snapshot:', up.error?.message || 'ok');
  } else {
    console.log('tickets snapshot unchanged (no HD rows or empty payload)');
  }
}

console.log('\n=== AFTER ===');
const afterAll = await sb
  .from('os_tickets')
  .select(
    'ticket_id, title, source_ref, source_system, status, entity_id, requester_name, company_name, ai_generated, source_doc_id, links, description',
    { count: 'exact' },
  );
const afterHd = (afterAll.data || []).filter(isHelpDeskTicket);
console.log(
  'os_tickets total=',
  afterAll.count,
  'help_desk=',
  afterHd.length,
);
if (afterHd.length) {
  console.log(
    'REMAINING HD:',
    afterHd.map((t) => t.ticket_id + ' ' + t.title),
  );
}

const indaLeft = await sb
  .from('inda_ss_tickets')
  .select('ticket_id, title, tage_ticket_id', { count: 'exact' });
console.log('inda_ss_tickets left=', indaLeft.count, indaLeft.data);

const checklistCount = await sb
  .from('os_ssc_checklist_tasks')
  .select('*', { count: 'exact', head: true });
console.log(
  'os_ssc_checklist_tasks untouched count=',
  checklistCount.count,
);

const auditsLeft = await sb
  .from('os_ticket_audits')
  .select('*', { count: 'exact', head: true });
console.log('os_ticket_audits left=', auditsLeft.count);

console.log('\nSUMMARY', {
  deleted_help_desk_tickets: delTickets.data?.length ?? 0,
  deleted_audits: delAudits.data?.length ?? 0,
  deleted_inda_mirrors: indaDel.data?.length ?? 0,
  soft_deleted_messages: msgUp.data?.length ?? 0,
  help_desk_remaining: afterHd.length,
  os_tickets_before: beforeAll.count,
  os_tickets_after: afterAll.count,
});
