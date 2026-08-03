'use client';

import { useState, useTransition } from 'react';

export function ContactRefreshButton({
  contactId,
  orgSlug = 'tage',
}: {
  contactId: string;
  orgSlug?: string;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        onClick={() =>
          start(async () => {
            setMsg(null);
            const res = await fetch('/api/spine/jobs', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contact_id: contactId,
                org_slug: orgSlug,
                job_type: 'contact.enrich',
              }),
            });
            const json = (await res.json()) as {
              ok?: boolean;
              jobId?: string;
              error?: string;
            };
            setMsg(
              json.ok
                ? `Queued ${json.jobId?.slice(0, 8) || 'job'}…`
                : json.error || 'queue failed',
            );
          })
        }
      >
        {pending ? 'Queuing…' : 'Contact Info Refresh'}
      </button>
      {msg ? <span className="text-[11px] text-muted-foreground">{msg}</span> : null}
    </div>
  );
}
