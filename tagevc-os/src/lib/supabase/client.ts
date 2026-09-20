import { createBrowserClient } from '@supabase/ssr';

import { supabaseClientOptions } from '@/lib/supabase/supabase-options';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    supabaseClientOptions,
  );
}
