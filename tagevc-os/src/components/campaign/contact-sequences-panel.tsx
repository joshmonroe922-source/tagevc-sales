'use client';

import { useEffect, useState } from 'react';

type Enrollment = {
  id: string;
  state: string;
  entered_at: string;
  ecc_journeys?: { name?: string; journey_type?: string } | null;
};

export function ContactSequencesPanel({ contactId }: { contactId: string }) {
  const [rows, setRows] = useState<Enrollment[]>([]);
  const [journeys, setJourneys] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [journeyId, setJourneyId] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const [e, j] = await Promise.all([
      fetch(`/api/campaign/v1/contacts/${contactId}/enrollments`).then((r) =>
        r.json(),
      ),
      fetch('/api/campaign/v1/journeys').then((r) => r.json()),
    ]);
    setRows(e.data || []);
    setJourneys(
      (j.data || []).map((x: { id: string; name: string }) => ({
        id: x.id,
        name: x.name,
      })),
    );
  }

  useEffect(() => {
    void load();
  }, [contactId]);

  async function enroll() {
    if (!journeyId) return;
    const res = await fetch(
      `/api/campaign/v1/contacts/${contactId}/enrollments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ journey_id: journeyId }),
      },
    );
    const j = await res.json();
    setMsg(res.ok ? 'Enrolled' : j.error?.message || 'Enroll failed');
    await load();
  }

  async function markConversing() {
    await fetch(
      `/api/campaign/v1/contacts/${contactId}/conversation-state`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'manual' }),
      },
    );
    setMsg('Cadences paused — conversation detected');
    await load();
  }

  return (
    <section className="rounded-lg border border-[#e5e0d6] bg-white/80 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
          Sequences
        </h2>
        <button
          type="button"
          onClick={markConversing}
          className="text-xs text-[#6b7280] underline-offset-2 hover:underline"
        >
          Mark as conversing
        </button>
      </div>
      <ul className="mb-4 space-y-2 text-sm">
        {rows.length === 0 ? (
          <li className="text-[#6b7280]">No active enrollments</li>
        ) : (
          rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between rounded-md bg-[#f7f4ef] px-3 py-2"
            >
              <span>
                {r.ecc_journeys?.name || 'Sequence'} · {r.state}
              </span>
              <span className="text-xs text-[#9ca3af]">
                {new Date(r.entered_at).toLocaleDateString()}
              </span>
            </li>
          ))
        )}
      </ul>
      <div className="flex flex-wrap gap-2">
        <select
          value={journeyId}
          onChange={(e) => setJourneyId(e.target.value)}
          className="rounded-md border border-[#e5e0d6] px-2 py-1.5 text-sm"
        >
          <option value="">Add to sequence…</option>
          {journeys.map((j) => (
            <option key={j.id} value={j.id}>
              {j.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={enroll}
          className="rounded-md bg-[#3a414f] px-3 py-1.5 text-sm text-white"
        >
          Enroll
        </button>
      </div>
      {msg ? <p className="mt-2 text-xs text-[#5c6570]">{msg}</p> : null}
    </section>
  );
}
