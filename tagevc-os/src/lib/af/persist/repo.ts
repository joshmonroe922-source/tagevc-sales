/**
 * A&F workspace persistence — dedicated os_af_workspace (not retired snapshots).
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import type { AfStore } from '@/lib/af/seed/store';

const WORKSPACE_KEY = 'default';

let hydratePromise: Promise<AfStore | null> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let hydrated = false;

export function isAfStoreHydrated() {
  return hydrated;
}

export function markAfStoreHydrated() {
  hydrated = true;
}

export async function loadAfWorkspace(): Promise<AfStore | null> {
  try {
    const supabase = await createPersistClient();
    if (!supabase) return null;
    const { data, error } = await supabase
      .from('os_af_workspace')
      .select('payload, updated_at')
      .eq('workspace_key', WORKSPACE_KEY)
      .maybeSingle();
    if (error) {
      console.error('loadAfWorkspace', error.message);
      return null;
    }
    if (!data?.payload || typeof data.payload !== 'object') return null;
    const payload = data.payload as Partial<AfStore>;
    if (!Array.isArray(payload.invoices) || !Array.isArray(payload.checklist)) {
      return null;
    }
    return payload as AfStore;
  } catch (e) {
    console.error('loadAfWorkspace', e);
    return null;
  }
}

export async function saveAfWorkspace(store: AfStore): Promise<boolean> {
  try {
    const supabase = await createPersistClient();
    if (!supabase) return false;
    let updatedBy: string | null = null;
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      updatedBy = user?.id ?? null;
    } catch {
      updatedBy = null;
    }
    const { error } = await supabase.from('os_af_workspace').upsert(
      {
        workspace_key: WORKSPACE_KEY,
        payload: store,
        version: 1,
        updated_at: new Date().toISOString(),
        updated_by: updatedBy,
      },
      { onConflict: 'workspace_key' },
    );
    if (error) {
      console.error('saveAfWorkspace', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('saveAfWorkspace', e);
    return false;
  }
}

export function queueAfPersist(getStore: () => AfStore) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void saveAfWorkspace(getStore());
  }, 400);
}

export async function hydrateAfWorkspaceOnce(
  seedFactory: () => AfStore,
  apply: (store: AfStore) => void,
): Promise<AfStore> {
  if (hydrated) {
    return seedFactory(); // caller already has live store; this path unused when hydrated
  }
  if (!hydratePromise) {
    hydratePromise = (async () => {
      const loaded = await loadAfWorkspace();
      if (loaded) {
        apply(loaded);
        hydrated = true;
        return loaded;
      }
      const seeded = seedFactory();
      apply(seeded);
      await saveAfWorkspace(seeded);
      hydrated = true;
      return seeded;
    })().catch((e) => {
      console.error('hydrateAfWorkspaceOnce', e);
      hydratePromise = null;
      const seeded = seedFactory();
      apply(seeded);
      hydrated = true;
      return seeded;
    });
  }
  return (await hydratePromise)!;
}
