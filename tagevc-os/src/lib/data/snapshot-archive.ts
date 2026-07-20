import { createPersistClient } from '@/lib/supabase/persist-client';
import type { StoreCollection } from '@/lib/data/persist';
import { ALL_PIPELINE_SNAPSHOT_DOMAINS } from '@/lib/data/persist';

export type ArchiveResult = {
  ok: boolean;
  collection: string;
  skipped?: boolean;
  reason?: string;
  error?: string;
  archive_id?: string;
  archived_at?: string;
};

export async function archiveStoreSnapshot(
  collection: StoreCollection | string,
  opts?: { note?: string; archivedBy?: string | null },
): Promise<ArchiveResult> {
  try {
    const supabase = await createPersistClient();
    const { data, error } = await supabase.rpc('archive_store_snapshot', {
      p_collection: collection,
      p_note: opts?.note ?? null,
      p_archived_by: opts?.archivedBy ?? null,
    });

    if (error) {
      console.error('archiveStoreSnapshot', error.message);
      return {
        ok: false,
        collection: String(collection),
        error: error.message.includes('archive_store_snapshot')
          ? 'Apply Phase 16 SQL first (archive_store_snapshot)'
          : error.message,
      };
    }

    const row = (data ?? {}) as Record<string, unknown>;
    return {
      ok: Boolean(row.ok),
      collection: String(row.collection ?? collection),
      skipped: Boolean(row.skipped),
      reason: row.reason ? String(row.reason) : undefined,
      error: row.error ? String(row.error) : undefined,
      archive_id: row.archive_id ? String(row.archive_id) : undefined,
      archived_at: row.archived_at ? String(row.archived_at) : undefined,
    };
  } catch (e) {
    console.error('archiveStoreSnapshot', e);
    return {
      ok: false,
      collection: String(collection),
      error: e instanceof Error ? e.message : 'archive failed',
    };
  }
}

export async function listSnapshotArchives(limit = 50) {
  try {
    const supabase = await createPersistClient();
    const { data, error } = await supabase
      .from('os_store_snapshot_archive')
      .select('id, collection, version, source_updated_at, archived_at, note')
      .order('archived_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error('listSnapshotArchives', error.message);
      return null;
    }
    return data ?? [];
  } catch (e) {
    console.error('listSnapshotArchives', e);
    return null;
  }
}

/** Collections that are safe candidates when write cutover is active. */
export function defaultArchiveCandidates(): StoreCollection[] {
  return [...ALL_PIPELINE_SNAPSHOT_DOMAINS];
}
