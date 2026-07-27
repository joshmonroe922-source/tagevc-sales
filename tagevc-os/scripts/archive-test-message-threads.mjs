/**
 * Soft-archive 3 TEST Message Center threads + soft-delete their messages.
 * Usage (from tagevc-os): node --env-file=.env.local scripts/archive-test-message-threads.mjs
 *
 * Targets:
 * 1. Tage Venture Capital · Shared service … (TK-619202607252)
 * 2. SS-INDA-20260723-GR6Q
 * 3. LD-004 · Ledgerly ("Test")
 *
 * List query already filters archived_at IS NULL — no wipe of other firm messaging.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const archivedAt = new Date().toISOString();

const { data: convs, error } = await sb
  .from('os_conversations')
  .select(
    'id, kind, title, linked_ref_type, linked_ref_id, last_message_preview, last_message_at, archived_at, entity_id',
  )
  .is('archived_at', null)
  .order('last_message_at', { ascending: false, nullsFirst: false })
  .limit(100);
if (error) {
  console.error('list', error.message);
  process.exit(1);
}

const targets = (convs ?? []).filter((c) => {
  const title = (c.title || '').toLowerCase();
  const preview = (c.last_message_preview || '').toLowerCase();
  const linked = c.linked_ref_id || '';
  if (['TK-619202607252', 'SS-INDA-20260723-GR6Q', 'LD-004'].includes(linked)) {
    return true;
  }
  if (title.includes('ledgerly') || title.includes('ld-004')) return true;
  if (title.includes('ss-inda-20260723-gr6q')) return true;
  if (preview.includes('what exactly did you want me to post about')) return true;
  if (
    title.includes('shared service') &&
    (!c.last_message_preview || preview.includes('no messages'))
  ) {
    return true;
  }
  if (title.includes('tage venture capital') && title.includes('shared')) {
    return true;
  }
  return false;
});

console.log('matched', targets.length);
for (const t of targets) {
  console.log({
    id: t.id,
    title: t.title,
    linked: `${t.linked_ref_type}:${t.linked_ref_id}`,
    preview: t.last_message_preview,
  });
}

const ids = targets.map((t) => t.id);
if (ids.length === 0) {
  console.error('No matching threads — aborting');
  process.exit(2);
}

const { data: archived, error: archErr } = await sb
  .from('os_conversations')
  .update({ archived_at: archivedAt, updated_at: archivedAt })
  .in('id', ids)
  .is('archived_at', null)
  .select('id, title, linked_ref_id, archived_at');
if (archErr) {
  console.error('archive', archErr.message);
  process.exit(1);
}
console.log('archived conversations', archived);

const { data: msgs, error: msgErr } = await sb
  .from('os_messages')
  .update({ deleted_at: archivedAt })
  .in('conversation_id', ids)
  .is('deleted_at', null)
  .select('id, conversation_id');
if (msgErr) {
  console.warn('message soft-delete', msgErr.message);
} else {
  console.log('soft-deleted messages', msgs?.length ?? 0);
}

const { count } = await sb
  .from('os_conversations')
  .select('id', { count: 'exact', head: true })
  .is('archived_at', null);
console.log('remaining active conversations', count);
