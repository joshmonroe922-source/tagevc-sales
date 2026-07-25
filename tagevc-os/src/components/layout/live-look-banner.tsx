'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { stopLiveLookAction } from '@/app/(app)/live-look/actions';
import { Button } from '@/components/ui/button';
import { entityDisplayName } from '@/lib/entities/display-name';

export function LiveLookBanner({
  userName,
  userEmail,
  entityId,
}: {
  userName: string | null;
  userEmail: string;
  entityId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const company = entityDisplayName(entityId);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-300/60 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-50">
      <p className="font-medium">
        Live Look · Read only · {userName || userEmail} · {company}
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        className="h-7 border-amber-400 bg-background"
        onClick={() =>
          start(async () => {
            await stopLiveLookAction();
            router.refresh();
          })
        }
      >
        Exit Live Look
      </Button>
    </div>
  );
}
