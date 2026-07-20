import {
  ALL_PIPELINE_SNAPSHOT_DOMAINS,
  shouldWriteSnapshot,
} from '@/lib/data/persist';
import { listSnapshotArchives } from '@/lib/data/snapshot-archive';
import { createPersistClient } from '@/lib/supabase/persist-client';

type PipelineCollection =
  | 'deal_flow'
  | 'tickets'
  | 'documents'
  | 'ma'
  | 're';

/** Primary normalized table that must be non-empty before Stage 4. */
const DOMAIN_PRIMARY_TABLE: Record<PipelineCollection, string> = {
  deal_flow: 'os_leads',
  tickets: 'os_tickets',
  documents: 'os_documents',
  ma: 'os_ma_targets',
  re: 'os_re_deals',
};

export type DrillCheck = {
  name: string;
  ok: boolean;
  detail?: string;
};

export type DomainDrillResult = {
  collection: PipelineCollection;
  pass: boolean;
  checks: DrillCheck[];
};

export type EmptySnapshotDrillReport = {
  ok: boolean;
  stage4_ready: boolean;
  fetched_at: string;
  results: DomainDrillResult[];
  summary: string;
};

function isPayloadEmpty(payload: unknown): boolean {
  if (payload == null) return true;
  if (typeof payload !== 'object' || Array.isArray(payload)) return false;
  return Object.keys(payload as object).length === 0;
}

async function tableCount(
  table: string,
): Promise<{ count: number; error?: string }> {
  try {
    const supabase = await createPersistClient();
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    if (error) {
      return { count: -1, error: error.message };
    }
    return { count: count ?? 0 };
  } catch (e) {
    return {
      count: -1,
      error: e instanceof Error ? e.message : 'count failed',
    };
  }
}

/**
 * Empty-snapshot drills for cut-over pipeline domains.
 * Read-only: verifies write cutover, empty live payload, SQL rows, and archive.
 */
export async function runEmptySnapshotDrills(opts?: {
  collections?: PipelineCollection[];
}): Promise<EmptySnapshotDrillReport> {
  const collections =
    opts?.collections ?? ([...ALL_PIPELINE_SNAPSHOT_DOMAINS] as PipelineCollection[]);

  const supabase = await createPersistClient();
  const { data: snapshots } = await supabase
    .from('os_store_snapshots')
    .select('collection, payload, updated_at');

  const byCollection = new Map(
    (snapshots ?? []).map((s) => [String(s.collection), s]),
  );

  const archives = await listSnapshotArchives(100);
  const archivedCollections = new Set(
    (archives ?? []).map((a) => String(a.collection)),
  );

  const results: DomainDrillResult[] = [];

  for (const collection of collections) {
    const checks: DrillCheck[] = [];
    const gate = shouldWriteSnapshot(collection);
    checks.push({
      name: 'write_cutover',
      ok: !gate.allow,
      detail: gate.allow
        ? `Snapshot writes still allowed (${gate.reason})`
        : gate.reason,
    });

    const snap = byCollection.get(collection);
    const empty = snap ? isPayloadEmpty(snap.payload) : true;
    checks.push({
      name: 'live_payload_empty',
      ok: empty,
      detail: snap
        ? empty
          ? `Empty since ${snap.updated_at}`
          : 'Live payload still has keys — soft-archive first'
        : 'No live snapshot row (treated as empty)',
    });

    const table = DOMAIN_PRIMARY_TABLE[collection];
    const { count, error } = await tableCount(table);
    checks.push({
      name: 'normalized_rows',
      ok: count > 0,
      detail:
        error ??
        (count > 0
          ? `${table} · ${count} rows`
          : `${table} is empty — refuse Stage 4`),
    });

    checks.push({
      name: 'archive_present',
      ok: archivedCollections.has(collection),
      detail: archivedCollections.has(collection)
        ? 'Archive row found'
        : 'No archive row — soft-archive before Stage 4',
    });

    results.push({
      collection,
      pass: checks.every((c) => c.ok),
      checks,
    });
  }

  const ok = results.every((r) => r.pass);
  const stage4_ready = ok;
  const failed = results.filter((r) => !r.pass).map((r) => r.collection);

  return {
    ok,
    stage4_ready,
    fetched_at: new Date().toISOString(),
    results,
    summary: ok
      ? `All ${results.length} domain drills passed — Stage 4 planning unblocked`
      : `Failed: ${failed.join(', ') || 'unknown'}`,
  };
}

/** Safety map for soft-archive — primary table must be non-empty. */
export async function assertArchiveSafe(
  collections: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const c of collections) {
    if (!(c in DOMAIN_PRIMARY_TABLE)) continue;
    const table = DOMAIN_PRIMARY_TABLE[c as PipelineCollection];
    const { count, error } = await tableCount(table);
    if (error) {
      return { ok: false, error: `Safety check failed for ${c}: ${error}` };
    }
    if (count <= 0) {
      return {
        ok: false,
        error: `Safety check failed: ${table} is empty — refuse to archive ${c}`,
      };
    }
  }
  return { ok: true };
}
