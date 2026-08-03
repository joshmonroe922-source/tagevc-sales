'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function CampaignActions({
  campaignId,
  status,
  canApprove,
}: {
  campaignId: string;
  status: string;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function call(path: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/campaign/v1/campaigns/${campaignId}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || 'Action failed');
      setMsg('Updated');
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === 'draft' ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => call('submit')}
          className="rounded-md border border-[#d6d0c4] px-3 py-2 text-sm"
        >
          Submit for approval
        </button>
      ) : null}
      {status === 'pending_approval' && canApprove ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => call('approve')}
          className="rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white"
        >
          Approve
        </button>
      ) : null}
      {['approved', 'scheduled', 'draft'].includes(status) ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => call('schedule')}
          className="rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white"
        >
          Send now
        </button>
      ) : null}
      {['sending', 'scheduled'].includes(status) ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => call('pause')}
          className="rounded-md border border-[#d6d0c4] px-3 py-2 text-sm"
        >
          Pause
        </button>
      ) : null}
      {!['sent', 'cancelled'].includes(status) ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => call('cancel')}
          className="rounded-md px-3 py-2 text-sm text-red-700"
        >
          Cancel
        </button>
      ) : null}
      {msg ? <span className="text-xs text-[#5c6570]">{msg}</span> : null}
    </div>
  );
}
