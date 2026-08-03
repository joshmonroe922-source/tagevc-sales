import { createClient as createSupabaseJsClient } from '@supabase/supabase-js';

type PersistMode = 'service' | 'user' | 'auto';

/**
 * Persist client for graph writes / workers / crons.
 * - mode:'service' — service role (bypasses RLS); use after authz check
 * - mode:'user' — cookie JWT; RLS applies (org isolation)
 * - mode:'auto' (default) — service if key present, else user session
 */
export async function createPersistClient(opts?: { mode?: PersistMode }) {
  const mode = opts?.mode ?? 'auto';
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (mode === 'user') {
    const { createClient } = await import('@/lib/supabase/server');
    return createClient();
  }

  if (mode === 'service' || mode === 'auto') {
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && service) {
      return createSupabaseJsClient(url, service, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
    if (mode === 'service') {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY required for service mode');
    }
  }

  const { createClient } = await import('@/lib/supabase/server');
  return createClient();
}

/** Cookie/JWT user client — RLS applies. Alias for mode:'user'. */
export async function createUserScopedClient() {
  return createPersistClient({ mode: 'user' });
}

/** Explicit service-role only (throws if missing). */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY required for service client');
  }
  return createSupabaseJsClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Alias used by acceptance tests / call sites. */
export const createServiceClient = createServiceRoleClient;
