import { createPostgrestJwtSkewFetch } from '@/lib/supabase/postgrest-jwt-skew';

/** Shared Supabase client options (SSR + browser). */
export const supabaseClientOptions = {
  global: {
    fetch: createPostgrestJwtSkewFetch(),
  },
} as const;
