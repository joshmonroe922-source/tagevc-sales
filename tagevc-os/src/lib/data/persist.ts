import { createPersistClient } from '@/lib/supabase/persist-client';

export type StoreCollection =
  | 'deal_flow'
  | 'tickets'
  | 'documents'
  | 'ma'
  | 're'
  | 'portfolio_seed';

type SnapshotRow = {
  collection: string;
  payload: unknown;
  version: number;
  updated_at: string;
};

const hydrateFlags = new Map<StoreCollection, boolean>();
const persistTimers = new Map<StoreCollection, ReturnType<typeof setTimeout>>();

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
