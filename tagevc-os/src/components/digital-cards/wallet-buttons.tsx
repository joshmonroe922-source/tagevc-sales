'use client';

import { useEffect, useState } from 'react';

type Availability = { apple: boolean; google: boolean };

type Props = {
  publicId: string;
  /** Visual variant for public card (light surface) vs My Card (dark bar). */
  variant?: 'light' | 'dark';
  className?: string;
};

export function WalletButtons({
  publicId,
  variant = 'light',
  className = '',
}: Props) {
  const [avail, setAvail] = useState<Availability | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/card/wallet/status')
      .then((r) => r.json())
      .then((j: { apple?: boolean; google?: boolean }) => {
        if (cancelled) return;
        setAvail({
          apple: Boolean(j.apple),
          google: Boolean(j.google),
        });
      })
      .catch(() => {
        if (!cancelled) setAvail({ apple: false, google: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!avail || (!avail.apple && !avail.google)) {
    return null;
  }

  const dark = variant === 'dark';
  const btn = dark
    ? 'inline-flex h-9 items-center rounded-lg bg-white/10 px-3 text-sm text-white hover:bg-white/20'
    : 'inline-flex h-10 flex-1 items-center justify-center rounded-xl border border-[#d7d3c3] bg-[#faf8f4] px-3 text-sm font-medium text-[#3B4559] transition hover:bg-white active:scale-[0.98]';

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {avail.apple ? (
        <a
          href={`/api/card/wallet/apple/${encodeURIComponent(publicId)}?src=wallet`}
          className={btn}
        >
          Add to Apple Wallet
        </a>
      ) : null}
      {avail.google ? (
        <a
          href={`/api/card/wallet/google/${encodeURIComponent(publicId)}?src=wallet`}
          className={btn}
          target="_blank"
          rel="noreferrer"
        >
          Add to Google Wallet
        </a>
      ) : null}
    </div>
  );
}
