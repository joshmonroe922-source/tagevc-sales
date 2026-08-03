'use client';

import { useState } from 'react';
import { MergeFieldsPicker } from '@/components/campaign/merge-fields-picker';
import { useRouter } from 'next/navigation';

export function CampaignBuilder({
  lists,
  templates,
}: {
  lists: Array<{ id: string; name: string; count_cached: number }>;
  templates: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('Hello {{contact.first_name | default: "there"}}');
  const [html, setHtml] = useState(
    '<p>Hi {{contact.first_name | default: "there"}},</p><p>Quick note from our team.</p>',
  );
  const [listId, setListId] = useState(lists[0]?.id || '');
  const [templateId, setTemplateId] = useState(templates[0]?.id || '');
  const [preview, setPreview] = useState<{ subject: string; html: string; missing_fields: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveDraft() {
    setBusy(true);
    setError(null);
    try {
      let tid = templateId;
      if (!tid) {
        const tRes = await fetch('/api/campaign/v1/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `${name || 'Campaign'} template`, html }),
        });
        const tJ = await tRes.json();
        if (!tRes.ok) throw new Error(tJ.error?.message || 'Template failed');
        tid = tJ.data.id;
      }
      const res = await fetch('/api/campaign/v1/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || 'Untitled campaign',
          subject,
          template_id: tid,
          audience: listId ? { type: 'list', id: listId } : undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || 'Create failed');
      router.push(
        `/shared-services/marketing/email-campaign-center/campaigns/${j.data.id}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    const res = await fetch('/api/campaign/v1/templates/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, html }),
    });
    const j = await res.json();
    if (res.ok) setPreview(j.data);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <div className="space-y-4 rounded-lg border border-[#e5e0d6] bg-white/90 p-5">
        <label className="block text-sm">
          <span className="mb-1 block text-[#5c6570]">Campaign name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-[#e5e0d6] px-3 py-2"
            placeholder="April nurture blast"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[#5c6570]">Audience list</span>
          <select
            value={listId}
            onChange={(e) => setListId(e.target.value)}
            className="w-full rounded-md border border-[#e5e0d6] px-3 py-2"
          >
            <option value="">Select list…</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.count_cached})
              </option>
            ))}
          </select>
        </label>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm text-[#5c6570]">Subject</span>
            <MergeFieldsPicker
              onInsert={(t) => setSubject((s) => `${s}${t}`)}
            />
          </div>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-md border border-[#e5e0d6] px-3 py-2 text-sm"
          />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm text-[#5c6570]">Body (HTML / Liquid)</span>
            <MergeFieldsPicker onInsert={(t) => setHtml((h) => `${h}${t}`)} />
          </div>
          <textarea
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            rows={12}
            className="w-full rounded-md border border-[#e5e0d6] px-3 py-2 font-mono text-xs"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={runPreview}
            className="rounded-md border border-[#d6d0c4] px-4 py-2 text-sm"
          >
            Preview
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={saveDraft}
            className="rounded-md bg-[#3a414f] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save draft'}
          </button>
        </div>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </div>
      <div className="rounded-lg border border-[#e5e0d6] bg-[#fbfaf7] p-5">
        <p className="text-xs font-medium tracking-wider text-[#9ca3af] uppercase">
          Live preview
        </p>
        {preview ? (
          <div className="mt-3 space-y-3">
            <p className="font-medium text-[#3a414f]">{preview.subject}</p>
            {preview.missing_fields?.length ? (
              <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                Missing: {preview.missing_fields.join(', ')}
              </p>
            ) : null}
            <div
              className="prose prose-sm max-w-none rounded-md bg-white p-4"
              dangerouslySetInnerHTML={{ __html: preview.html }}
            />
          </div>
        ) : (
          <p className="mt-3 text-sm text-[#6b7280]">
            Preview renders merge fields + compliance footer (CAN-SPAM / RFC 8058).
          </p>
        )}
      </div>
    </div>
  );
}
