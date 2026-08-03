import { campaignDb } from '@/lib/campaign/db/client';
import { addSuppression, recordConsent } from '@/lib/campaign/db/repo';
import { normalizeEmail } from '@/lib/campaign/core/consent';

export async function handleOneClickUnsub(token: string) {
  const sb = await campaignDb();
  const { data: row } = await sb
    .from('ecc_pref_tokens')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  if (!row) return { ok: false as const, error: 'Invalid token' };
  if (row.contact_id) {
    await recordConsent({
      entityId: row.entity_id,
      contactId: row.contact_id,
      status: 'opt_out',
      source: 'unsub_one_click',
      topic: 'marketing',
    });
  } else {
    await addSuppression(
      row.entity_id,
      row.email_normalized,
      'unsub',
      'unsub_one_click',
    );
  }
  return { ok: true as const, entityId: row.entity_id };
}

export async function getPrefCenter(token: string) {
  const sb = await campaignDb();
  const { data: row } = await sb
    .from('ecc_pref_tokens')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  if (!row) return null;
  const { data: topics } = await sb
    .from('ecc_preference_topics')
    .select('*')
    .eq('entity_id', row.entity_id);
  return { token: row, topics: topics ?? [] };
}

export async function recordOpen(trackingToken: string, meta?: {
  userAgent?: string;
  ip?: string;
}) {
  const sb = await campaignDb();
  const { data: msg } = await sb
    .from('ecc_send_messages')
    .select('id, entity_id, contact_id, open_count')
    .eq('tracking_token', trackingToken)
    .maybeSingle();
  if (!msg) return null;
  const isMachine = Boolean(
    meta?.userAgent && /AppleBot|GoogleImageProxy|prefetch/i.test(meta.userAgent),
  );
  await sb.from('ecc_engagement_events').upsert(
    {
      entity_id: msg.entity_id,
      send_message_id: msg.id,
      contact_id: msg.contact_id,
      event_type: 'open',
      user_agent: meta?.userAgent || null,
      ip: meta?.ip || null,
      is_machine_open: isMachine,
      idempotency_key: `open:${msg.id}:${new Date().toISOString().slice(0, 13)}`,
    },
    { onConflict: 'idempotency_key', ignoreDuplicates: true },
  );
  await sb
    .from('ecc_send_messages')
    .update({
      open_count: (msg.open_count || 0) + 1,
      last_activity_at: new Date().toISOString(),
    })
    .eq('id', msg.id);
  const { bumpRecipientScore } = await import('@/lib/campaign/db/repo');
  await bumpRecipientScore(msg.id);
  return msg;
}

export async function recordClick(trackingToken: string, url: string, meta?: {
  userAgent?: string;
  ip?: string;
}) {
  const sb = await campaignDb();
  let msgId: string | null = null;
  let entityId: string | null = null;
  let contactId: string | null = null;
  let originalUrl = url;

  const { data: link } = await sb
    .from('ecc_link_map')
    .select('send_message_id, original_url')
    .eq('tracking_token', trackingToken)
    .maybeSingle();
  if (link) {
    msgId = link.send_message_id;
    originalUrl = link.original_url;
    const { data: msg } = await sb
      .from('ecc_send_messages')
      .select('id, entity_id, contact_id, click_count')
      .eq('id', msgId)
      .maybeSingle();
    if (msg) {
      entityId = msg.entity_id;
      contactId = msg.contact_id;
      await sb
        .from('ecc_send_messages')
        .update({
          click_count: (msg.click_count || 0) + 1,
          last_activity_at: new Date().toISOString(),
        })
        .eq('id', msg.id);
    }
  } else {
    const { data: msg } = await sb
      .from('ecc_send_messages')
      .select('id, entity_id, contact_id, click_count')
      .eq('tracking_token', trackingToken)
      .maybeSingle();
    if (msg) {
      msgId = msg.id;
      entityId = msg.entity_id;
      contactId = msg.contact_id;
      await sb
        .from('ecc_send_messages')
        .update({
          click_count: (msg.click_count || 0) + 1,
          last_activity_at: new Date().toISOString(),
        })
        .eq('id', msg.id);
    }
  }

  if (msgId && entityId) {
    await sb.from('ecc_engagement_events').insert({
      entity_id: entityId,
      send_message_id: msgId,
      contact_id: contactId,
      event_type: 'click',
      url: originalUrl,
      user_agent: meta?.userAgent || null,
      ip: meta?.ip || null,
      idempotency_key: `click:${msgId}:${normalizeEmail(originalUrl).slice(0, 80)}:${Date.now()}`,
    });
    const { bumpRecipientScore } = await import('@/lib/campaign/db/repo');
    await bumpRecipientScore(msgId);
  }
  return originalUrl;
}
