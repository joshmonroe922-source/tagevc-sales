/**
 * One-shot: soft-void TEST Document Library seeds DOC-001 + DOC-002.
 * Schema has no archived_at on os_documents; status = 'Voided' is the soft-delete.
 * Usage (from tagevc-os): node --env-file=.env.local scripts/archive-demo-documents.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const voidedAt = '2026-07-26T18:00:00.000Z';
const docIds = ['DOC-001', 'DOC-002'];
const note = 'Soft-archived TEST seed (Document Library cleanup 2026-07-26)';

const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: before, error: beforeErr } = await sb
  .from('os_documents')
  .select('doc_id, title, status, entity_id')
  .in('doc_id', docIds);
if (beforeErr) {
  console.error('fetch documents', beforeErr.message);
  process.exit(1);
}
console.log('Before:', before);

const { data: voided, error: voidErr } = await sb
  .from('os_documents')
  .update({
    status: 'Voided',
    notes: note,
    updated_at: voidedAt,
  })
  .in('doc_id', docIds)
  .neq('status', 'Voided')
  .select('doc_id, title, status, entity_id');
if (voidErr) {
  console.error('update documents', voidErr.message);
  process.exit(1);
}
console.log('Voided:', voided);

// Patch documents snapshot payload if still present (pre-cutover safety).
const { data: snaps, error: snapErr } = await sb
  .from('os_store_snapshots')
  .select('collection, payload, version')
  .eq('collection', 'documents')
  .limit(1);
if (snapErr) {
  console.warn('snapshot read skipped:', snapErr.message);
} else if (snaps?.[0]?.payload) {
  const payload = snaps[0].payload;
  let changed = false;
  if (Array.isArray(payload.docs)) {
    for (const d of payload.docs) {
      if (docIds.includes(d.doc_id) && d.status !== 'Voided') {
        d.status = 'Voided';
        d.notes = note;
        d.updated_at = voidedAt;
        changed = true;
      }
    }
  }
  if (changed) {
    const { error: upErr } = await sb.from('os_store_snapshots').upsert({
      collection: 'documents',
      payload,
      version: snaps[0].version ?? 1,
      updated_at: voidedAt,
    });
    if (upErr) console.warn('snapshot update failed:', upErr.message);
    else console.log('Patched documents snapshot payload');
  } else {
    console.log('Snapshot already voided or empty of target docs');
  }
} else {
  console.log('No documents snapshot row (SQL-primary / retired)');
}

const { data: after } = await sb
  .from('os_documents')
  .select('doc_id, title, status, entity_id')
  .in('doc_id', docIds)
  .order('doc_id');
console.log('After:', after);
console.log('Done', { voidedAt, count: voided?.length ?? 0 });
