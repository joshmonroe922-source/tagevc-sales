'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function SequenceCreateForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [mutex, setMutex] = useState('recruiting_outreach');

  async function create() {
    if (!name.trim()) return;
    await fetch('/api/campaign/v1/journeys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        journey_type: 'sequence',
        mutex_group: mutex || null,
        default_delivery_plane: 'graph',
        graph_json: {
          nodes: [
            {
              id: 'step1',
              type: 'email',
              config: { delivery_plane: 'graph', include_signature: true },
            },
            {
              id: 'step2',
              type: 'call_vm_email',
              config: {
                send_email_on: ['no_answer', 'vm_dropped'],
                delay_email_seconds: 60,
                plane: 'graph',
              },
            },
          ],
          edges: [{ from: 'step1', to: 'step2' }],
        },
      }),
    });
    setName('');
    router.refresh();
  }

  return (
    <div className="flex flex-wrap gap-2 rounded-lg border border-[#e5e0d6] bg-white p-4">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Sequence name"
        className="rounded-md border border-[#e5e0d6] px-3 py-2 text-sm"
      />
      <input
        value={mutex}
        onChange={(e) => setMutex(e.target.value)}
        placeholder="mutex_group"
        className="rounded-md border border-[#e5e0d6] px-3 py-2 text-sm"
      />
      <button
        type="button"
        onClick={create}
        className="rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white"
      >
        Create sequence
      </button>
    </div>
  );
}
