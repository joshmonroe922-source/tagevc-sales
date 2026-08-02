'use client';

import { useState, useTransition } from 'react';
import { actionSendW9Request } from '@/app/(app)/shared-services/af/actions';

export function W9RequestButton(props: {
  vendorId: string;
  vendorName: string;
  vendorEmail: string;
  entityCode: string;
  taxYear: number;
  mailtoFallback: string;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending || !props.vendorEmail}
        className="text-left text-sm font-medium underline underline-offset-2 disabled:opacity-50"
        onClick={() => {
          start(async () => {
            const r = await actionSendW9Request({
              vendorId: props.vendorId,
              vendorName: props.vendorName,
              vendorEmail: props.vendorEmail,
              entityCode: props.entityCode,
              taxYear: props.taxYear,
            });
            if (r.ok) {
              setMsg(`Sent (${r.messageId.slice(0, 8)}…)`);
            } else {
              setMsg(`Send failed — ${r.error}. Use mailto fallback.`);
            }
          });
        }}
      >
        {pending ? 'Sending…' : `Request W-9 ${props.taxYear}`}
      </button>
      <a
        href={props.mailtoFallback}
        className="text-xs text-muted-foreground underline underline-offset-2"
      >
        mailto fallback
      </a>
      {msg ? (
        <span className="text-xs text-muted-foreground">{msg}</span>
      ) : null}
    </div>
  );
}
