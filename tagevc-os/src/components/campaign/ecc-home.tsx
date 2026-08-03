'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ECC_ROUTE_PREFIX } from '@/lib/campaign/core/types';

type EccHome = {
  stats?: { campaigns?: number; lists?: number; templates?: number; suppressed?: number };
  hotFollowUps?: Array<{ contactId: string; email?: string; reason?: string; score?: number }>;
  needsApproval?: Array<{ id: string; name: string }>;
};

export function EccHomeClient({ home }: { home: EccHome }) {
  const router = useRouter();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-semibold text-[#3a414f]">Today</h2>
          <p className="text-sm text-muted-foreground">Hot follow-ups, approvals, and deliverability in one place.</p>
        </div>
        <Button className="bg-[#3a414f] text-[#ece9e6] hover:bg-[#2f3642]" onClick={() => router.push(`${ECC_ROUTE_PREFIX}/campaigns/new`)}>New campaign</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Campaigns', home.stats?.campaigns, `${ECC_ROUTE_PREFIX}/campaigns`],
          ['Lists', home.stats?.lists, `${ECC_ROUTE_PREFIX}/audiences`],
          ['Templates', home.stats?.templates, `${ECC_ROUTE_PREFIX}/templates`],
          ['Suppressed', home.stats?.suppressed, `${ECC_ROUTE_PREFIX}/deliverability`],
        ].map(([label, value, href]) => (
          <Link key={String(label)} href={String(href)} className="rounded-lg border border-[#d7d3c3] bg-white/80 px-4 py-3 hover:border-[#9f957c]">
            <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
            <p className="font-heading mt-1 text-2xl font-semibold text-[#3a414f]">{value ?? 0}</p>
          </Link>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-[#d7d3c3] bg-white p-4">
          <h3 className="font-heading mb-3 text-lg text-[#3a414f]">Hot follow-ups</h3>
          {(home.hotFollowUps || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Engagement appears here after sends.</p>
          ) : (
            <ul className="divide-y divide-[#ece9e6]">
              {(home.hotFollowUps || []).map((f) => (
                <li key={`${f.contactId}-${f.score}`} className="flex justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-[#3a414f]">{f.email || f.contactId}</p>
                    <p className="text-xs text-muted-foreground">{f.reason}</p>
                  </div>
                  <span className="rounded bg-[#ece9e6] px-2 py-0.5 text-xs">{f.score}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-lg border border-[#d7d3c3] bg-white p-4">
          <h3 className="font-heading mb-3 text-lg text-[#3a414f]">Needs approval</h3>
          {(home.needsApproval || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No campaigns waiting.</p>
          ) : (
            (home.needsApproval || []).map((c) => (
            <Link key={c.id} href={`${ECC_ROUTE_PREFIX}/campaigns/${c.id}`} className="mb-2 block rounded border border-[#ece9e6] px-3 py-2 text-sm hover:border-[#9f957c]">{c.name}</Link>
          ))
          )}
        </section>
      </div>
    </div>
  );
}

type Named = { id: string; name: string; count_cached?: number };
type CampaignInitial = {
  id?: string; name?: string; subject?: string; body_html?: string; audience_id?: string;
};

export function CampaignBuilderClient({ lists, templates, initial }: { lists: Named[]; templates: Named[]; initial?: CampaignInitial }) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name || '');
  const [subject, setSubject] = useState(initial?.subject || '');
  const [body, setBody] = useState(initial?.body_html || '');
  const [listId, setListId] = useState(initial?.audience_id || '');
  const [fields, setFields] = useState<Array<{ object?: string; label?: string; insert_token?: string }>>([]);
  const [preview, setPreview] = useState<{ subject?: string; html?: string; missing?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadFields() {
    const res = await fetch('/api/campaign/v1/templates?merge_fields=1');
    const json = await res.json();
    setFields(json.fields || []);
  }
  async function runPreview() {
    const res = await fetch('/api/campaign/v1/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', subject, html: body }) });
    setPreview(await res.json());
  }
  async function save(approve = false) {
    setBusy(true); setError(null);
    try {
      let id = initial?.id;
      if (!id) {
        const res = await fetch('/api/campaign/v1/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name || 'Untitled', subject, body_html: body, audience_type: listId ? 'list' : null, audience_id: listId || null }) });
        const json = await res.json();
        if (!json.campaign) throw new Error(json.error?.message || 'Create failed');
        id = json.campaign.id;
      } else {
        await fetch(`/api/campaign/v1/campaigns/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', name, subject, body_html: body, audience_type: listId ? 'list' : null, audience_id: listId || null }) });
      }
      if (approve) {
        await fetch(`/api/campaign/v1/campaigns/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'submit' }) });
        await fetch(`/api/campaign/v1/campaigns/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve' }) });
      }
      router.push(`${ECC_ROUTE_PREFIX}/campaigns/${id}`);
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <div className="space-y-3">
        <input className="w-full rounded-md border border-[#d7d3c3] px-3 py-2 text-sm" placeholder="Campaign name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="w-full rounded-md border border-[#d7d3c3] px-3 py-2 text-sm" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea className="min-h-[200px] w-full rounded-md border border-[#d7d3c3] px-3 py-2 font-mono text-sm" value={body} onChange={(e) => setBody(e.target.value)} placeholder='<p>Hi {{contact.first_name | default: "there"}},</p>' />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={() => save(false)}>Save draft</Button>
          <Button className="bg-[#3a414f] text-[#ece9e6]" disabled={busy} onClick={() => save(true)}>Save &amp; approve</Button>
          <Button variant="ghost" disabled={busy} onClick={runPreview}>Preview</Button>
          <Button variant="ghost" disabled={busy} onClick={loadFields}>Merge fields</Button>
        </div>
        {preview?.html ? <div className="rounded border border-[#d7d3c3] bg-white p-4"><p className="font-medium">{preview.subject}</p><div className="prose prose-sm mt-2" dangerouslySetInnerHTML={{ __html: preview.html }} /></div> : null}
      </div>
      <aside className="space-y-3">
        <div className="rounded-lg border border-[#d7d3c3] bg-white p-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">Audience list</p>
          <select className="mt-1 w-full rounded border border-[#d7d3c3] px-2 py-2 text-sm" value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">Select…</option>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.count_cached})</option>)}
          </select>
        </div>
        <div className="rounded-lg border border-[#d7d3c3] bg-white p-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">Template</p>
          <select className="mt-1 w-full rounded border border-[#d7d3c3] px-2 py-2 text-sm" onChange={(e) => {
            const t = templates.find((x) => x.id === e.target.value);
            if (t) { if (!subject) setSubject(t.subject); if (!body) setBody(t.html); }
          }}>
            <option value="">Blank</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        {fields.length ? (
          <div className="max-h-64 overflow-auto rounded-lg border border-[#d7d3c3] bg-white p-3">
            {fields.map((f) => (
              <button key={f.insert_token} type="button" className="mb-1 block w-full rounded px-2 py-1 text-left text-xs hover:bg-[#ece9e6]" onClick={() => setBody((b: string) => b + f.insert_token)}>
                <span className="font-medium">{f.label}</span>
                <span className="block font-mono text-[10px] text-muted-foreground">{f.insert_token}</span>
              </button>
            ))}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
