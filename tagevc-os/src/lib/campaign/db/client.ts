import { createPersistClient } from '@/lib/supabase/persist-client';
export async function campaignDb() {
  return createPersistClient({ mode: 'service' });
}
