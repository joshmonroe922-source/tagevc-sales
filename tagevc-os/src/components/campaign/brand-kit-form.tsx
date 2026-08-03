'use client';

import { useState } from 'react';

export function BrandKitForm({
  initial,
  canEdit,
}: {
  initial: {
    physical_address: string;
    footer_html: string;
    logo_url: string;
  };
  canEdit: boolean;
}) {
  const [form, setForm] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    const res = await fetch('/api/campaign/v1/brand-kit', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setMsg(res.ok ? 'Saved' : 'Save failed');
  }

  return (
    <div className="max-w-xl space-y-3 rounded-lg border border-[#e5e0d6] bg-white p-4">
      {(
        [
          ['physical_address', 'Physical address'],
          ['logo_url', 'Logo URL'],
          ['footer_html', 'Footer HTML'],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="block text-sm">
          <span className="mb-1 block text-[#5c6570]">{label}</span>
          {key === 'footer_html' ? (
            <textarea
              disabled={!canEdit}
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              rows={4}
              className="w-full rounded-md border border-[#e5e0d6] px-3 py-2"
            />
          ) : (
            <input
              disabled={!canEdit}
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              className="w-full rounded-md border border-[#e5e0d6] px-3 py-2"
            />
          )}
        </label>
      ))}
      {canEdit ? (
        <button
          type="button"
          onClick={save}
          className="rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white"
        >
          Save brand kit
        </button>
      ) : (
        <p className="text-xs text-[#9ca3af]">Admin required to edit</p>
      )}
      {msg ? <p className="text-xs text-[#5c6570]">{msg}</p> : null}
    </div>
  );
}
