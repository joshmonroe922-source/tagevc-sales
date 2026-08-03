'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { MergeFieldsPicker } from '@/components/campaign/merge-fields-picker';

export function TemplateCreateForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [html, setHtml] = useState(
    '<p>Hi {{contact.first_name | default: "there"}},</p><p>{{account.name}}</p>',
  );

  async function save() {
    if (!name.trim()) return;
    await fetch('/api/campaign/v1/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, html }),
    });
    setName('');
    router.refresh();
  }

  return (
    <div className="space-y-3 rounded-lg border border-[#e5e0d6] bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Template name"
          className="rounded-md border border-[#e5e0d6] px-3 py-2 text-sm"
        />
        <MergeFieldsPicker onInsert={(t) => setHtml((h) => `${h}${t}`)} />
        <button
          type="button"
          onClick={save}
          className="rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white"
        >
          Save template
        </button>
      </div>
      <textarea
        value={html}
        onChange={(e) => setHtml(e.target.value)}
        rows={6}
        className="w-full rounded-md border border-[#e5e0d6] px-3 py-2 font-mono text-xs"
      />
    </div>
  );
}
