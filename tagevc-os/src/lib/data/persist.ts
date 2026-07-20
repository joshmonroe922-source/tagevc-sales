import { createPersistClient } from '@/lib/supabase/persist-client';

export type StoreCollection =
  | 'deal_flow'
  | 'tickets'
  | 'documents'
  | 'ma'
  | 're'
  | 'portfolio_seed';

/** Domains Phase 15 treats as mature for optional write cutover. */
export const MATURE_SNAPSHOT_DOMAINS: StoreCollection[] = [
  'deal_flow',
  'tickets',
  'documents',
];

/** Phase 16 — all pipeline domains eligible for full write cutover. */
export const ALL_PIPELINE_SNAPSHOT_DOMAINS: StoreCollection[] = [
  'deal_flow',
  'tickets',
  'documents',
  'ma',
  're',
];

type SnapshotRow = {
  collection: string;
  payload: unknown;
  version: number;
  updated_at: string;
};

type SnapshotWriteStat = {
  writes: number;
  skips: number;
  lastWriteAt: string | null;
  lastSkipAt: string | null;
  lastSkipReason: string | null;
};

const hydrateFlags = new Map<StoreCollection, boolean>();
const persistTimers = new Map<StoreCollection, ReturnType<typeof setTimeout>>();
const snapshotWriteStats = new Map<StoreCollection, SnapshotWriteStat>();

function ensureWriteStat(collection: StoreCollection): SnapshotWriteStat {
  let s = snapshotWriteStats.get(collection);
  if (!s) {
    s = {
      writes: 0,
      skips: 0,
      lastWriteAt: null,
      lastSkipAt: null,
      lastSkipReason: null,
    };
    snapshotWriteStats.set(collection, s);
  }
  return s;
}

function parseDomainList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Phase 15–16 write-cutover gate (reversible via env).
 *
 * Defaults: all snapshot writes enabled (dual-write).
 *
 * - WRITE_SNAPSHOTS=0|false → suppress all unless listed in SNAPSHOT_WRITE_DOMAINS
 * - SNAPSHOT_SKIP_DOMAINS=deal_flow,tickets,documents,ma,re → skip listed
 * - WRITE_CUTOVER_MATURE=1 → skip MATURE_SNAPSHOT_DOMAINS (leads/deals/tickets/docs)
 * - WRITE_CUTOVER_ALL=1 → skip ALL_PIPELINE_SNAPSHOT_DOMAINS (includes MA/RE)
 */
export function shouldWriteSnapshot(collection: StoreCollection): {
  allow: boolean;
  reason: string;
} {
  const writeFlag = process.env.WRITE_SNAPSHOTS;
  const writesOff =
    writeFlag === '0' || writeFlag === 'false' || writeFlag === 'off';

  if (writesOff) {
    const allowlist = parseDomainList(process.env.SNAPSHOT_WRITE_DOMAINS);
    if (allowlist.includes(collection)) {
      return { allow: true, reason: 'allowlisted while WRITE_SNAPSHOTS=0' };
    }
    return { allow: false, reason: 'WRITE_SNAPSHOTS=0' };
  }

  const skipList = parseDomainList(process.env.SNAPSHOT_SKIP_DOMAINS);
  if (skipList.includes(collection)) {
    return { allow: false, reason: 'SNAPSHOT_SKIP_DOMAINS' };
  }

  const allCutover =
    process.env.WRITE_CUTOVER_ALL === '1' ||
    process.env.WRITE_CUTOVER_ALL === 'true';
  if (allCutover && ALL_PIPELINE_SNAPSHOT_DOMAINS.includes(collection)) {
    return { allow: false, reason: 'WRITE_CUTOVER_ALL' };
  }

  const matureCutover =
    process.env.WRITE_CUTOVER_MATURE === '1' ||
    process.env.WRITE_CUTOVER_MATURE === 'true';
  if (matureCutover && MATURE_SNAPSHOT_DOMAINS.includes(collection)) {
    return { allow: false, reason: 'WRITE_CUTOVER_MATURE' };
  }

  return { allow: true, reason: 'dual_write' };
}

export function getSnapshotWriteConfig() {
  const writeFlag = process.env.WRITE_SNAPSHOTS;
  const writesOff =
    writeFlag === '0' || writeFlag === 'false' || writeFlag === 'off';
  return {
    write_snapshots_enabled: !writesOff,
    snapshot_write_domains: writesOff
      ? parseDomainList(process.env.SNAPSHOT_WRITE_DOMAINS)
      : ('all' as const),
    snapshot_skip_domains: parseDomainList(process.env.SNAPSHOT_SKIP_DOMAINS),
    write_cutover_mature:
      process.env.WRITE_CUTOVER_MATURE === '1' ||
      process.env.WRITE_CUTOVER_MATURE === 'true',
    write_cutover_all:
      process.env.WRITE_CUTOVER_ALL === '1' ||
      process.env.WRITE_CUTOVER_ALL === 'true',
    mature_domains: [...MATURE_SNAPSHOT_DOMAINS],
    all_pipeline_domains: [...ALL_PIPELINE_SNAPSHOT_DOMAINS],
  };
}

export function getSnapshotWriteStats(): Record<string, SnapshotWriteStat> {
  return Object.fromEntries(snapshotWriteStats.entries());
}

export function markStoreHydrated(collection: StoreCollection) {
  hydrateFlags.set(collection, true);
}

export function isStoreHydrated(collection: StoreCollection) {
  return hydrateFlags.get(collection) === true;
}

export async function loadStoreSnapshot<T>(
  collection: StoreCollection,
): Promise<{ payload: T; updated_at: string } | null> {
  try {
    const supabase = await createPersistClient();
    const { data, error } = await supabase
      .from('os_store_snapshots')
      .select('collection, payload, version, updated_at')
      .eq('collection', collection)
      .maybeSingle();

    if (error) {
      console.error(`loadStoreSnapshot(${collection})`, error.message);
      return null;
    }
    if (!data) return null;
    const row = data as SnapshotRow;
    return { payload: row.payload as T, updated_at: row.updated_at };
  } catch (e) {
    console.error(`loadStoreSnapshot(${collection})`, e);
    return null;
  }
}

export async function saveStoreSnapshot(
  collection: StoreCollection,
  payload: unknown,
): Promise<boolean> {
  const gate = shouldWriteSnapshot(collection);
  if (!gate.allow) {
    const stat = ensureWriteStat(collection);
    stat.skips += 1;
    stat.lastSkipAt = new Date().toISOString();
    stat.lastSkipReason = gate.reason;
    return true; // treated as success — intentionally not writing
  }

  try {
    const supabase = await createPersistClient();
    let updatedBy: string | null = null;
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      updatedBy = user?.id ?? null;
    } catch {
      updatedBy = null;
    }

    const { error } = await supabase.from('os_store_snapshots').upsert(
      {
        collection,
        payload,
        version: 1,
        updated_at: new Date().toISOString(),
        updated_by: updatedBy,
      },
      { onConflict: 'collection' },
    );

    if (error) {
      console.error(`saveStoreSnapshot(${collection})`, error.message);
      return false;
    }
    const stat = ensureWriteStat(collection);
    stat.writes += 1;
    stat.lastWriteAt = new Date().toISOString();
    return true;
  } catch (e) {
    console.error(`saveStoreSnapshot(${collection})`, e);
    return false;
  }
}

/** Debounced persist so bursty mutations don't spam writes. */
export function queueStorePersist(
  collection: StoreCollection,
  getPayload: () => unknown,
) {
  const gate = shouldWriteSnapshot(collection);
  if (!gate.allow) {
    const stat = ensureWriteStat(collection);
    stat.skips += 1;
    stat.lastSkipAt = new Date().toISOString();
    stat.lastSkipReason = gate.reason;
    return;
  }

  const existing = persistTimers.get(collection);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    persistTimers.delete(collection);
    void saveStoreSnapshot(collection, getPayload());
  }, 250);
  persistTimers.set(collection, timer);
}

let bootstrapPromise: Promise<void> | null = null;

/**
 * Hydrate all domain stores once per server process / request cycle entry.
 * Called from the authenticated app layout.
 */
export async function hydrateAllStores(loaders: {
  dealFlow: () => Promise<void>;
  tickets: () => Promise<void>;
  documents: () => Promise<void>;
  ma: () => Promise<void>;
  re: () => Promise<void>;
}): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      await Promise.all([
        loaders.dealFlow(),
        loaders.tickets(),
        loaders.documents(),
        loaders.ma(),
        loaders.re(),
      ]);
    })().catch((e) => {
      bootstrapPromise = null;
      console.error('hydrateAllStores failed', e);
    });
  }
  await bootstrapPromise;
}
