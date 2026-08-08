'use client';

import { useMemo } from 'react';

const ALLOWED_RETURN_HOSTS = new Set([
  'portal.recruit619.com',
  'portal.instantnda.us',
  'portal.instantnda.com', // legacy alias
  'portal.signenthr.com',
  'localhost',
  '127.0.0.1',
]);

function safeReturnHref(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.protocol === 'http:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      return null;
    }
    if (!ALLOWED_RETURN_HOSTS.has(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function labelForHost(href: string): string {
  try {
    const host = new URL(href).hostname;
    if (host.includes('recruit619')) return 'Recruit 619 portal';
    if (host.includes('instantnda')) return 'Instant NDA portal';
    if (host.includes('signent')) return 'Signent HR portal';
    return 'portal';
  } catch {
    return 'portal';
  }
}

/** Same-tab handoff return chip when opened from a subsidiary portal. */
export function PortalReturnBanner({
  returnTo,
  from,
}: {
  returnTo?: string | null;
  from?: string | null;
}) {
  const href = useMemo(() => safeReturnHref(returnTo), [returnTo]);
  if (!href) return null;

  const label = labelForHost(href);
  const fromHint = from?.trim() ? ` · via ${from.trim()}` : '';

  return (
    <div className="mb-3">
      <a
        href={href}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[#e0dcd2] bg-white px-3 py-1.5 text-sm text-[#3B4559] shadow-sm hover:bg-[#faf8f4]"
      >
        ← Back to {label}
        <span className="text-xs text-muted-foreground">{fromHint}</span>
      </a>
    </div>
  );
}
