'use client';

import { useEffect } from 'react';
import { TZ_COOKIE } from '@/lib/timezone/user-timezone';

/**
 * Persists browser IANA timezone. Microsoft mailbox TZ is preferred when
 * synced via calendar presence; cookie is the practical fallback.
 */
export function TimezoneBootstrap() {
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!tz) return;
      document.cookie = `${TZ_COOKIE}=${encodeURIComponent(tz)}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {
      /* ignore */
    }
  }, []);
  return null;
}
