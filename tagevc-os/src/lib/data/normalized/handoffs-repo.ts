import { createPersistClient } from '@/lib/supabase/persist-client';
import type { HandoffPack } from '@/lib/types';

function handoffToRow(h: HandoffPack) {
  return {
    id: h.id,
    handoff_id: h.handoff_id,
    track: h.track,
    source_id: h.source_id,
    company_name: h.company_name,
    entity_id: h.entity_id,
    portfolio_id: h.portfolio_id,
    status: h.status,
    path: h.path,
    close_date: h.close_date,
    thesis: h.thesis,
    checklist_notes: h.checklist_notes,
    created_at: h.created_at,
    updated_at: h.updated_at,
  };
}

function rowToHandoff(row: Record<string, unknown>): HandoffPack {
  return {
    id: String(row.id),
    handoff_id: String(row.handoff_id),
    track: row.track as HandoffPack['track'],
    source_id: String(row.source_id),
    company_name: String(row.company_name),
    entity_id: (row.entity_id as string | null) ?? null,
    portfolio_id: (row.portfolio_id as string | null) ?? null,
    status: row.status as HandoffPack['status'],
    path: (row.path as HandoffPack['path']) ?? null,
    close_date: row.close_date == null ? null : String(row.close_date),
    thesis: (row.thesis as string | null) ?? null,
    checklist_notes: (row.checklist_notes as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function fetchAllHandoffs(): Promise<HandoffPack[] | null> {
  try {
    const supabase = await createPersistClient();
    const { data, error } = await supabase
      .from('os_handoffs')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) {
      console.error('fetchAllHandoffs', error.message);
      return null;
    }
    return (data ?? []).map((r) => rowToHandoff(r as Record<string, unknown>));
  } catch (e) {
    console.error('fetchAllHandoffs', e);
    return null;
  }
}

export async function syncHandoffs(handoffs: HandoffPack[]): Promise<boolean> {
  try {
    if (handoffs.length === 0) return true;
    const supabase = await createPersistClient();
    const { error } = await supabase
      .from('os_handoffs')
      .upsert(handoffs.map(handoffToRow), { onConflict: 'handoff_id' });
    if (error) {
      console.error('syncHandoffs', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('syncHandoffs', e);
    return false;
  }
}

export function filterHandoffsByTrack(
  handoffs: HandoffPack[],
  track: HandoffPack['track'] | HandoffPack['track'][],
): HandoffPack[] {
  const tracks = Array.isArray(track) ? track : [track];
  return handoffs.filter((h) => tracks.includes(h.track));
}
