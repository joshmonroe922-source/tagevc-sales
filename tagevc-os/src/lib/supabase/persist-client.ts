import { createClient as createSupabaseJsClient } from '@supabase/supabase-js';

/** Prefer service role for background/webhook writes; else cookie session. */
export async function createPersistClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && service) {
    return createSupabaseJsClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  const { createClient } = await import('@/lib/supabase/server');
  return createClient();
}
