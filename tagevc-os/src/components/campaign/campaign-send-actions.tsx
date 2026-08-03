'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function CampaignSendActions({
  campaignId,
  status,
  replyTo,
}: {
  campaignId: string;
  status: string;
  replyTo: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function act(action: string, body: Record<string, unknown> = {}) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(
      `/api/campaign/v1/campaigns?id=${campaignId}&action=${action}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    const json = await res.json();
    setBusy(false);
    if (!json.ok) {
      setMsg(json.error?.message || 'Action failed');
      return;
    }
    if (action === 'send') {
      setMsg(
        `Sent ${json.sent}/${json.planned} (skipped ${json.skipped}, errors ${json.errors})`,
      );
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        {status === 'draft' ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => act('submit')}
          >
            Submit
          </Button>
        ) : null}
        {status === 'pending_approval' || status === 'draft' ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => act('approve')}
          >
            Approve
          </Button>
        ) : null}
        {['approved', 'scheduled'].includes(status) ? (
          <Button
            size="sm"
            className="bg-[#3a414f] text-[#ece9e6]"
            disabled={busy}
            onClick={() =>
              act('send', {
                replyTo,
                // Caller can paste Graph token from M365 connect when available
              })
            }
          >
            Send now
          </Button>
        ) : null}
        {['sending', 'scheduled', 'approved'].includes(status) ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => act('pause')}
          >
            Pause
          </Button>
        ) : null}
      </div>
      {msg ? <p className="max-w-xs text-right text-xs text-muted-foreground">{msg}</p> : null}
      {['approved', 'scheduled'].includes(status) ? (
        <p className="max-w-xs text-right text-[11px] text-amber-800">
          Send requires a delegated Graph token (`userAccessToken`) from M365
          connect for the bulk plane.
        </p>
      ) : null}
    </div>
  );
}
