'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { runIesGlobalSyncAction } from '@/app/(app)/shared-services/finance/ies-actions';
import { Button } from '@/components/ui/button';
import {
  formatIesLastSynced,
  iesConnectHref,
  iesOpenInBooksHref,
} from '@/lib/ies/ux';
import { cn } from '@/lib/utils';

type Props = {
  /** Entity for Connect OAuth (Finance/IES map). Null = generic connect. */
  entityId?: string | null;
  canConnect?: boolean;
  canRefresh?: boolean;
  /** Show Connect when not connected / awaiting IES. */
  showConnect?: boolean;
  /** Show Open in IES / QuickBooks deep link. */
  showOpenInIes?: boolean;
  /** ISO timestamp of last global sync (or company as_of fallback). */
  lastSyncedAt?: string | null;
  /** Credentials configured for OAuth. */
  configured?: boolean;
  /** Sync feature flag on. */
  syncEnabled?: boolean;
  className?: string;
  size?: 'sm' | 'xs';
  /** Compact = buttons only; default includes last-synced line. */
  compact?: boolean;
};

/**
 * Shared Connect (per-entity OAuth) + global Refresh + Open in IES.
 * Refresh always syncs all connected companies to limit refresh spam.
 */
export function IesSyncControls({
  entityId = null,
  canConnect = false,
  canRefresh = false,
  showConnect = false,
  showOpenInIes = true,
  lastSyncedAt = null,
  configured = true,
  syncEnabled = true,
  className,
  size = 'sm',
  compact = false,
}: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const connectHref = iesConnectHref(entityId);
  const openHref = iesOpenInBooksHref(entityId);
  const lastSyncedLabel = formatIesLastSynced(lastSyncedAt);

  if (!canConnect && !canRefresh && !showOpenInIes) {
    return lastSyncedLabel && !compact ? (
      <p className={cn('text-xs text-muted-foreground', className)}>
        Last synced · {lastSyncedLabel}
      </p>
    ) : null;
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex flex-wrap items-center gap-2">
        {canConnect && showConnect ? (
          configured ? (
            <Button size={size} render={<a href={connectHref} />}>
              Connect
            </Button>
          ) : (
            <Button size={size} disabled>
              Connect
            </Button>
          )
        ) : null}
        {canRefresh ? (
          <Button
            size={size}
            variant="outline"
            disabled={pending || !configured || !syncEnabled}
            onClick={() =>
              start(async () => {
                setMessage(null);
                const res = await runIesGlobalSyncAction();
                if ('error' in res && res.error && !('message' in res)) {
                  setMessage(res.error);
                } else if ('message' in res) {
                  setMessage(res.message);
                } else if ('error' in res && res.error) {
                  setMessage(res.error);
                } else {
                  setMessage('Sync finished');
                }
                router.refresh();
              })
            }
          >
            {pending ? 'Refreshing…' : 'Refresh'}
          </Button>
        ) : null}
        {showOpenInIes && openHref ? (
          <a
            href={openHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium underline-offset-2 hover:underline"
          >
            Open in IES
          </a>
        ) : null}
        {!showConnect && canConnect && entityId ? (
          <Link
            href={`/shared-services/af/finance?entity=${encodeURIComponent(entityId)}`}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Finance books
          </Link>
        ) : null}
      </div>
      {!compact ? (
        <p className="text-xs text-muted-foreground">
          {lastSyncedLabel
            ? `Last synced · ${lastSyncedLabel}`
            : 'Last synced · never'}
          {message ? ` · ${message}` : null}
        </p>
      ) : message ? (
        <p className="text-xs text-muted-foreground">{message}</p>
      ) : null}
    </div>
  );
}
