'use client';

import { useEffect } from 'react';

import { createClient } from '@/lib/supabase/client';

export function SessionTimeoutWatcher() {
  useEffect(() => {
    const supabase = createClient();
    let seenSession = false;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) seenSession = true;
      if (event === 'SIGNED_OUT' && seenSession) {
        window.location.replace('/session-timeout');
      }
    });
    return () => subscription.unsubscribe();
  }, []);
  return null;
}
