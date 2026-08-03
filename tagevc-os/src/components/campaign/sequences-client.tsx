'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ECC_ROUTE_PREFIX } from '@/lib/campaign/core/types';

type JourneyRow = {
  id: string;
  name: string;
  journey_type: string;
  status: string;
  mutex_group: string | null;
  starter_pack_key?: string | null;
  updated_at?: string;
  graph_json?: { nodes?: unknown[] };
};

type PackCard = {
  key: string;
  name: string;
  description: string;
  vertical?: string;
  mutexGroup: string | null;
};

export function SequencesClient({
  journeys,
  packs,
}: {
  journeys: JourneyRow[];
  packs: PackCard[];
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [mutex, setMutex] = useState('recruiting_outreach');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createBlank() {
    if (!name.trim()) return;
    setBusy('create');
    setError(null);
    try {
      const res = await fetch('/api/campaign/v1/journeys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          journey_type: 'sequence',
          mutex_group: mutex || null,
          default_delivery_plane: 'graph',
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || 'Create failed');
      router.push(`${ECC_ROUTE_PREFIX}/sequences/${j.data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  async function installPack(key: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch('/api/campaign/v1/journeys/starter-packs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack_key: key }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || 'Install failed');
      router.push(`${ECC_ROUTE_PREFIX}/sequences/${j.data.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl font-semibold text-[#3a414f]">Sequences & journeys</h2>
        <p className="text-sm text-[#7c7871]">
          Visual canvas · mutex groups · Graph / MTA planes · call_vm_email · DocuSign goals
        </p>
      </div>

      {packs.length ? (
        <section className="space-y-3">
          <h3 className="font-heading text-base text-[#3a414f]">Vertical starter packs</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {packs.map((p) => (
              <div
                key={p.key}
                className="rounded-xl border border-[#d7d3c3] bg-gradient-to-br from-white to-[#f3efe6] p-4"
              >
                {p.vertical ? (
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8a7355]">
                    {p.vertical}
                  </p>
                ) : null}
                <h4 className="font-heading mt-1 text-[#3a414f]">{p.name}</h4>
                <p className="mt-1 text-xs text-[#7c7871]">{p.description}</p>
                {p.mutexGroup ? (
                  <p className="mt-2 text-[11px] text-[#5c6570]">mutex: {p.mutexGroup}</p>
                ) : null}
                <button
                  type="button"
                  disabled={busy === p.key}
                  onClick={() => installPack(p.key)}
                  className="mt-3 rounded-md bg-[#3a414f] px-3 py-1.5 text-xs text-white disabled:opacity-50"
                >
                  {busy === p.key ? 'Installing…' : 'Install pack'}
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2 rounded-xl border border-[#e5e0d6] bg-white p-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Blank sequence name"
          className="min-w-[180px] flex-1 rounded-md border border-[#e5e0d6] px-3 py-2 text-sm"
        />
        <input
          value={mutex}
          onChange={(e) => setMutex(e.target.value)}
          placeholder="mutex_group"
          className="w-44 rounded-md border border-[#e5e0d6] px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={busy === 'create'}
          onClick={createBlank}
          className="rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          Create blank
        </button>
      </div>
      {error ? <p className="text-sm text-[#7a4a4a]">{error}</p> : null}

      {journeys.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#d7d3c3] bg-white/60 px-4 py-10 text-center text-sm text-[#7c7871]">
          No journeys yet — install a starter pack or create a blank sequence.
        </p>
      ) : (
        <ul className="divide-y divide-[#e5e0d6] rounded-xl border border-[#d7d3c3] bg-white">
          {journeys.map((j) => (
            <li key={j.id}>
              <Link
                href={`${ECC_ROUTE_PREFIX}/sequences/${j.id}`}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 transition-colors hover:bg-[#f7f5f0]"
              >
                <div>
                  <p className="font-medium text-[#3a414f]">{j.name}</p>
                  <p className="text-xs text-[#7c7871]">
                    {j.journey_type} · {j.status}
                    {j.mutex_group ? ` · ${j.mutex_group}` : ''}
                    {j.starter_pack_key ? ` · pack ${j.starter_pack_key}` : ''}
                  </p>
                </div>
                <p className="text-xs text-[#5c6570]">
                  {(j.graph_json?.nodes?.length ?? 0)} nodes → open editor
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
