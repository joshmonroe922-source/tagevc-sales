'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
export function CampaignDetailActions({ campaignId, status, replyTo }: { campaignId: string; status: string; replyTo: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function act(action: string, body: Record<string, unknown> = {}) {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/campaign/v1/campaigns/${campaignId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, replyTo, ...body }) });
    const json = await res.json();
    setBusy(false);
    if (json.error) setMsg(json.error.message);
    else { setMsg(action === 'send' ? `Queued ${json.planned} recipients` : 'Updated'); router.refresh(); }
  }
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        {status === 'draft' ? <Button size="sm" variant="outline" disabled={busy} onClick={() => act('submit')}>Submit</Button> : null}
        {['draft','pending_approval'].includes(status) ? <Button size="sm" variant="outline" disabled={busy} onClick={() => act('approve')}>Approve</Button> : null}
        {['approved','scheduled'].includes(status) ? <Button size="sm" className="bg-[#3a414f] text-[#ece9e6]" disabled={busy} onClick={() => act('send')}>Queue send</Button> : null}
      </div>
      {msg ? <p className="text-xs text-muted-foreground">{msg}</p> : null}
      <p className="max-w-xs text-right text-[11px] text-amber-800">Send schedules jobs; worker drains with Graph token (controlled_graph plane).</p>
    </div>
  );
}
