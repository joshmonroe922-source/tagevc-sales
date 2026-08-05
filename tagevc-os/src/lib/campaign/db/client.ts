import { createPersistClient } from '@/lib/supabase/persist-client';

/** Service-preferring Supabase client for ECC enrollment writes. */
export async function campaignDb() {
  return createPersistClient();
}
