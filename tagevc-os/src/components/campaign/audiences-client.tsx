'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ListActionBar } from '@/components/campaign/list-action-bar';
import { Button } from '@/components/ui/button';

export function AudiencesClient({
  lists,
}: {
  lists: Array<{
    id: string;
    name: string;
    description: string | null;
    count_cached: number;
    list_type: string;
  }>;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function createList() {
    if (!name.trim()) return;
    setBusy(true);
    await fetch('/api/campaign/v1/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', name: name.trim() }),
    });
    setName('');
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-[#d7d3c3] bg-white p-4">
        <div className="min-w-[200px] flex-1">
          <label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            New list
          </label>
          <input
            className="mt-1 w-full rounded-md border border-[#d7d3c3] px-3 py-2 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Warm leads — West"
          />
        </div>
        <Button
          disabled={busy}
          onClick={createList}
          className="bg-[#3a414f] text-[#ece9e6]"
        >
          Create list
        </Button>
      </div>

      <div className="space-y-3">
        {lists.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No lists yet. Create one, then add CRM contacts via API or list
            actions.
          </p>
        ) : (
          lists.map((l) => (
            <div
              key={l.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#d7d3c3] bg-white px-4 py-3"
            >
              <div>
                <p className="font-medium text-[#3a414f]">{l.name}</p>
                <p className="text-xs text-muted-foreground">
                  {l.count_cached} contacts · {l.list_type}
                  {l.description ? ` · ${l.description}` : ''}
                </p>
              </div>
              <ListActionBar listId={l.id} listName={l.name} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
