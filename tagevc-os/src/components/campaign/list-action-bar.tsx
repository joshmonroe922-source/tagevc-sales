'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ECC_ROUTE_PREFIX } from '@/lib/campaign/core/types';

export function ListActionBar({ listId, listName }: { listId: string; listName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [campaigns, setCampaigns] = useState<
    Array<{ id: string; name: string; status?: string }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function openChooser() {
    setOpen(true);
    const res = await fetch('/api/campaign/v1/campaigns?attachable=true');
    const json = await res.json();
    setCampaigns(json.campaigns || []);
  }
  async function createNew() {
    setBusy(true);
    const res = await fetch('/api/campaign/v1/lists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'email_campaign', mode: 'create', list_id: listId, draft: { name: `Campaign — ${listName}` } }) });
    const json = await res.json();
    setBusy(false);
    if (json.campaignId) router.push(`${ECC_ROUTE_PREFIX}/campaigns/${json.campaignId}`);
  }
  async function attach(id: string) {
    setBusy(true);
    const res = await fetch('/api/campaign/v1/lists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'email_campaign', mode: 'attach', list_id: listId, campaign_id: id }) });
    const json = await res.json();
    setBusy(false);
    if (json.campaignId) router.push(`${ECC_ROUTE_PREFIX}/campaigns/${json.campaignId}`);
  }
  async function dialer() {
    setBusy(true);
    const res = await fetch('/api/campaign/v1/lists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'power_dialer', list_id: listId }) });
    const json = await res.json();
    setBusy(false);
    setMsg(json.message || 'Queued');
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={dialer}>Power Dialer</Button>
      <Button size="sm" className="bg-[#3a414f] text-[#ece9e6]" disabled={busy} onClick={openChooser}>Email Campaign</Button>
      {msg ? <span className="text-xs text-muted-foreground">{msg}</span> : null}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-xl border border-[#d7d3c3] bg-white p-5">
            <h3 className="font-heading text-lg text-[#3a414f]">Email Campaign</h3>
            <p className="mt-1 text-sm text-muted-foreground">Attach <strong>{listName}</strong> or create new.</p>
            <Button className="mt-4 w-full bg-[#3a414f] text-[#ece9e6]" disabled={busy} onClick={createNew}>Create new</Button>
            <div className="mt-3 max-h-40 space-y-1 overflow-auto">
              {campaigns.map((c) => (
                <button key={c.id} type="button" className="flex w-full justify-between rounded border border-[#ece9e6] px-3 py-2 text-left text-sm hover:border-[#9f957c]" onClick={() => attach(c.id)}>
                  <span>{c.name}</span><span className="text-xs text-muted-foreground">{c.status}</span>
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" className="mt-3" onClick={() => setOpen(false)}>Close</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
