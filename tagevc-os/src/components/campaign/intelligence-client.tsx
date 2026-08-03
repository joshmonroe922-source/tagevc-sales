'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Dash = {
  entity_preferred_hour: number | null;
  heatmap: number[];
  band_counts: { hot: number; warm: number; cool: number; cold: number };
  top_contacts: Array<{
    id: string;
    name: string;
    email: string | null;
    score: number;
    band: string;
    preferred_send_hour: number | null;
  }>;
  people_filters: { hot: number; clicked_no_reply: number; opened: number };
  attribution: {
    sampled_touches: number;
    path_preview: string[];
    converted_rate_proxy?: number;
    click_to_call?: number;
    call_to_sign?: number;
    click_to_sign?: number;
    clicked: boolean;
    called: boolean;
    signed: boolean;
  };
  sto_confidence?: number;
  template_wins?: unknown[];
  ai_drafts: Array<{
    id: string;
    kind: string;
    status: string;
    tone: string;
    suggestion_text: string;
    created_at: string;
  }>;
  lift_experiment_note: string;
};

export function IntelligenceClient({ initial }: { initial: Dash }) {
  const router = useRouter();
  const [dash, setDash] = useState(initial);
  const [source, setSource] = useState('Hi {{contact.first_name | default: "there"}},\n\nQuick note about next steps.');
  const [tone, setTone] = useState('professional');
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const maxHeat = Math.max(1, ...dash.heatmap);

  async function refresh() {
    const res = await fetch('/api/campaign/v1/intelligence');
    const j = await res.json();
    if (res.ok) setDash(j.data);
  }

  async function recomputeSto() {
    setBusy('sto');
    setMsg(null);
    try {
      const res = await fetch('/api/campaign/v1/intelligence/sto', { method: 'POST' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || 'STO failed');
      setMsg(`Updated preferred hours for ${j.data.updated} contacts`);
      await refresh();
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  async function suggestAi() {
    setBusy('ai');
    setMsg(null);
    try {
      const res = await fetch('/api/campaign/v1/intelligence/ai-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'rewrite', source_text: source, tone }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || 'Assist failed');
      setPreview((j.data.suggestions || []).map((s: { text: string }) => s.text));
      setMsg('Suggestion stored as draft — human approve required (never auto-sends)');
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  async function review(id: string, status: 'approved' | 'rejected' | 'applied') {
    setBusy(id);
    await fetch(`/api/campaign/v1/intelligence/ai-assist/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    setBusy(null);
    await refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl font-semibold text-[#3a414f]">Engagement intelligence</h2>
        <p className="text-sm text-[#7c7871]">
          STO · RFM bands · attribution lite · AI copy assist (human approve only)
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Hot', value: dash.band_counts.hot },
          { label: 'Warm', value: dash.band_counts.warm },
          { label: 'Cool', value: dash.band_counts.cool },
          { label: 'Cold', value: dash.band_counts.cold },
        ].map((x) => (
          <div key={x.label} className="rounded-xl border border-[#d7d3c3] bg-white px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-[#7c7871]">{x.label}</p>
            <p className="font-heading mt-1 text-2xl text-[#3a414f]">{x.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-[#d7d3c3] bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-heading text-base text-[#3a414f]">Send-time heatmap</h3>
            <button
              type="button"
              disabled={busy === 'sto'}
              onClick={recomputeSto}
              className="rounded-md border border-[#d7d3c3] px-2 py-1 text-xs text-[#3a414f] disabled:opacity-50"
            >
              Recompute STO
            </button>
          </div>
          <p className="mt-1 text-xs text-[#7c7871]">
            Entity preferred hour:{' '}
            <span className="font-medium text-[#3a414f]">
              {dash.entity_preferred_hour == null ? 'insufficient signal' : `${dash.entity_preferred_hour}:00`}
            </span>
          </p>
          <div className="mt-4 flex h-28 items-end gap-1">
            {dash.heatmap.map((v, h) => (
              <div key={h} className="flex flex-1 flex-col items-center justify-end gap-1">
                <div
                  className="w-full rounded-sm bg-[#3a414f] transition-all"
                  style={{
                    height: `${Math.max(4, (v / maxHeat) * 100)}%`,
                    opacity: 0.35 + (v / maxHeat) * 0.65,
                  }}
                  title={`${h}:00 · weight ${v}`}
                />
                {h % 3 === 0 ? <span className="text-[9px] text-[#9ca3af]">{h}</span> : <span className="h-3" />}
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-[#8a7355]">{dash.lift_experiment_note}</p>
        </section>

        <section className="rounded-xl border border-[#d7d3c3] bg-white p-4">
          <h3 className="font-heading text-base text-[#3a414f]">People follow-up signals</h3>
          <ul className="mt-3 space-y-2 text-sm text-[#3a414f]">
            <li className="flex justify-between border-b border-[#f0ebe3] pb-2">
              <span>Hot (score ≥ 4)</span>
              <span className="font-medium">{dash.people_filters.hot}</span>
            </li>
            <li className="flex justify-between border-b border-[#f0ebe3] pb-2">
              <span>Clicked, no reply</span>
              <span className="font-medium">{dash.people_filters.clicked_no_reply}</span>
            </li>
            <li className="flex justify-between">
              <span>Opened</span>
              <span className="font-medium">{dash.people_filters.opened}</span>
            </li>
          </ul>
          <div className="mt-4 rounded-lg bg-[#f7f5f0] px-3 py-2 text-xs text-[#5c6570]">
            Attribution path:{' '}
            {dash.attribution.path_preview.length
              ? dash.attribution.path_preview.join(' → ')
              : 'no touches yet'}
            <br />
            Touches sampled: {dash.attribution.sampled_touches}
            {dash.attribution.signed ? ' · includes DocuSign complete' : ''}
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-[#d7d3c3] bg-white p-4">
        <h3 className="font-heading text-base text-[#3a414f]">Top engagement</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-[#7c7871]">
              <tr>
                <th className="pb-2 font-medium">Contact</th>
                <th className="pb-2 font-medium">Band</th>
                <th className="pb-2 font-medium">Score</th>
                <th className="pb-2 font-medium">STO hour</th>
              </tr>
            </thead>
            <tbody>
              {dash.top_contacts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-[#7c7871]">
                    No scored contacts yet
                  </td>
                </tr>
              ) : (
                dash.top_contacts.map((c) => (
                  <tr key={c.id} className="border-t border-[#f0ebe3]">
                    <td className="py-2">
                      <p className="text-[#3a414f]">{c.name}</p>
                      <p className="text-xs text-[#9ca3af]">{c.email}</p>
                    </td>
                    <td className="py-2 capitalize">{c.band}</td>
                    <td className="py-2">{c.score}</td>
                    <td className="py-2">
                      {c.preferred_send_hour == null ? '—' : `${c.preferred_send_hour}:00`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-[#d7d3c3] bg-gradient-to-br from-white to-[#f3efe6] p-4">
        <h3 className="font-heading text-base text-[#3a414f]">AI copy assist</h3>
        <p className="mt-1 text-xs text-[#7c7871]">
          Generates drafts only. Apply requires human approval. AI never auto-sends (N13).
        </p>
        <textarea
          value={source}
          onChange={(e) => setSource(e.target.value)}
          rows={4}
          className="mt-3 w-full rounded-md border border-[#e5e0d6] bg-white px-3 py-2 text-sm"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            className="rounded-md border border-[#e5e0d6] bg-white px-2 py-1.5 text-sm"
          >
            <option value="professional">professional</option>
            <option value="warm">warm</option>
            <option value="direct">direct</option>
            <option value="executive">executive</option>
          </select>
          <button
            type="button"
            disabled={busy === 'ai'}
            onClick={suggestAi}
            className="rounded-md bg-[#3a414f] px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            Suggest rewrite
          </button>
        </div>
        {preview.length ? (
          <div className="mt-3 space-y-2">
            {preview.map((t) => (
              <pre
                key={t.slice(0, 40)}
                className="whitespace-pre-wrap rounded-lg border border-[#e5e0d6] bg-white p-3 text-xs text-[#3a414f]"
              >
                {t}
              </pre>
            ))}
          </div>
        ) : null}
        {(dash.ai_drafts ?? []).length ? (
          <ul className="mt-4 space-y-2">
            {dash.ai_drafts.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-[#e5e0d6] bg-white px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] uppercase tracking-wider text-[#7c7871]">
                    {d.kind} · {d.status} · {d.tone}
                  </p>
                  <p className="mt-1 line-clamp-3 text-xs text-[#3a414f]">{d.suggestion_text}</p>
                </div>
                {d.status === 'suggested' ? (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      disabled={busy === d.id}
                      onClick={() => review(d.id, 'approved')}
                      className="rounded border border-[#d7d3c3] px-2 py-1 text-[11px]"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy === d.id}
                      onClick={() => review(d.id, 'rejected')}
                      className="rounded border border-[#d7d3c3] px-2 py-1 text-[11px]"
                    >
                      Reject
                    </button>
                  </div>
                ) : d.status === 'approved' ? (
                  <button
                    type="button"
                    disabled={busy === d.id}
                    onClick={() => review(d.id, 'applied')}
                    className="rounded bg-[#3a414f] px-2 py-1 text-[11px] text-white"
                  >
                    Mark applied
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {msg ? <p className="mt-3 text-xs text-[#5c6570]">{msg}</p> : null}
      </section>
    </div>
  );
}
