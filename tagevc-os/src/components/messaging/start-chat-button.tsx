'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { MessageSquare } from 'lucide-react';
import { openLinkedChatAction } from '@/app/(app)/messages/actions';
import { Button } from '@/components/ui/button';

type Props = {
  refType: 'lead' | 'deal' | 'entity' | 'task' | 'ticket' | 'document';
  refId: string;
  title: string;
  entityId?: string | null;
  variant?: 'default' | 'outline' | 'secondary';
  size?: 'default' | 'sm';
};

export function StartChatButton({
  refType,
  refId,
  title,
  entityId,
  variant = 'outline',
  size = 'sm',
}: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        variant={variant}
        size={size}
        className="gap-1.5"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const result = await openLinkedChatAction({
              refType,
              refId,
              title,
              entityId: entityId ?? null,
            });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.push(`/messages?c=${result.conversationId}`);
          });
        }}
      >
        <MessageSquare className="size-3.5" />
        {pending ? 'Opening…' : 'Chat'}
      </Button>
      {error ? (
        <span className="max-w-[14rem] text-right text-[11px] text-destructive">
          {error}{' '}
          <Link href="/messages" className="underline">
            Open Messages
          </Link>
        </span>
      ) : null}
    </div>
  );
}
