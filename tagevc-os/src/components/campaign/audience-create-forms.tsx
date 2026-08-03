'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function AudienceCreateForms() {
  const router = useRouter();
  const [listName, setListName] = useState('');
  const [segName, setSegName] = useState('');

  async function createList() {
    if (!listName.trim()) return;
    await fetch('/api/campaign/v1/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: listName }),
    });
    setListName('');
    router.refresh();
  }

  async function createSegment() {
    if (!segName.trim()) return;
    await fetch('/api/campaign/v1/segments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: segName,
        definition_json: {
          op: 'and',
          rules: [
            { field: 'contact.email_permission', op: 'eq', value: 'opted_in' },
            { field: 'contact.primary_email', op: 'exists' },
          ],
        },
      }),
    });
    setSegName('');
    router.refresh();
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-lg border border-[#e5e0d6] bg-white p-4">
        <p className="mb-2 text-sm font-medium">New list</p>
        <div className="flex gap-2">
          <input
            value={listName}
            onChange={(e) => setListName(e.target.value)}
            className="flex-1 rounded-md border border-[#e5e0d6] px-2 py-1.5 text-sm"
            placeholder="Q3 targets"
          />
          <button
            type="button"
            onClick={createList}
            className="rounded-md bg-[#3a414f] px-3 py-1.5 text-sm text-white"
          >
            Create
          </button>
        </div>
      </div>
      <div className="rounded-lg border border-[#e5e0d6] bg-white p-4">
        <p className="mb-2 text-sm font-medium">New segment</p>
        <div className="flex gap-2">
          <input
            value={segName}
            onChange={(e) => setSegName(e.target.value)}
            className="flex-1 rounded-md border border-[#e5e0d6] px-2 py-1.5 text-sm"
            placeholder="Opted-in with email"
          />
          <button
            type="button"
            onClick={createSegment}
            className="rounded-md bg-[#3a414f] px-3 py-1.5 text-sm text-white"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
