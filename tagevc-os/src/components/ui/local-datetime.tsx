'use client';

import { useEffect, useState } from 'react';
import {
  formatInTimezone,
  DEFAULT_TIMEZONE,
  TZ_COOKIE,
} from '@/lib/timezone/user-timezone';

type Variant = 'datetime' | 'date' | 'time';

type Props = {
  value: string | Date | null | undefined;
  fallback?: string;
  className?: string;
  variant?: Variant;
  /** Optional server-known Microsoft mailbox timezone (IANA). */
  timeZone?: string | null;
};

function readCookieTz(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${TZ_COOKIE}=`));
  if (!match) return null;
  try {
    return decodeURIComponent(match.slice(TZ_COOKIE.length + 1));
  } catch {
    return null;
  }
}

/**
 * Renders UTC timestamps in the viewer's Microsoft/browser timezone.
 */
export function LocalDateTime({
  value,
  fallback = '—',
  className,
  variant = 'datetime',
  timeZone,
}: Props) {
  const iso =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'string' && value.trim()
        ? value
        : null;

  const [label, setLabel] = useState<string>(() => {
    if (!iso) return fallback;
    return formatInTimezone(iso, timeZone || DEFAULT_TIMEZONE, variant);
  });

  useEffect(() => {
    if (!iso) {
      setLabel(fallback);
      return;
    }
    const tz =
      timeZone ||
      readCookieTz() ||
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      DEFAULT_TIMEZONE;
    setLabel(formatInTimezone(iso, tz, variant));
  }, [iso, fallback, variant, timeZone]);

  if (!iso) return <span className={className}>{fallback}</span>;
  return (
    <time dateTime={iso} className={className} title={iso}>
      {label}
    </time>
  );
}
