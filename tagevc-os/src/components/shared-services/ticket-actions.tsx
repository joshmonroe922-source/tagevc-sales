'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  approveDraftAction,
  rejectDraftAction,
  rediagnoseTicketAction,
  resolveTicketAction,
} from '@/app/(app)/shared-services/actions';
import { Button } from '@/components/ui/button';

export function TicketHumanActions({
  ticketId,
  showDraftActions,
}: {
  ticketId: string;
  showDraftActions: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-wrap gap-2">
      {showDraftActions ? (
        <>
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await approveDraftAction(ticketId);
                router.refresh();
              })
            }
          >
            Approve proposed action
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await rejectDraftAction(ticketId);
                router.refresh();
              })
            }
          >
            Reject / edit
          </Button>
        </>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await rediagnoseTicketAction(ticketId);
            if (!res.ok) alert(res.error);
            router.refresh();
          })
        }
      >
        Re-diagnose
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await resolveTicketAction(ticketId);
            if (!res.ok) alert(res.error);
            router.refresh();
          })
        }
      >
        Resolve
      </Button>
    </div>
  );
}
