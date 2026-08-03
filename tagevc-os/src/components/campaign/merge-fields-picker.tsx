'use client';

import { useEffect, useMemo, useState } from 'react';
import type { MergeField } from '@/lib/campaign/core/types';

export function MergeFieldsPicker({
  onInsert,
}: {
  onInsert: (token: string) => void;
}) {
  const [fields, setFields] = useState<MergeField[]>([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch('/api/campaign/v1/merge-fields')
      .then((r) => r.json())
      .then((j) => setFields(j.data || []))
      .catch(() => setFields([]));
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return fields;
    return fields.filter(
      (f) =>
        f.label.toLowerCase().includes(needle) ||
        f.api_name.toLowerCase().includes(needle) ||
        f.object.toLowerCase().includes(needle),
    );
  }, [fields, q]);

  const groups = useMemo(() => {
    const map = new Map<string, MergeField[]>();
    for (const f of filtered) {
      const arr = map.get(f.object) || [];
      arr.push(f);
      map.set(f.object, arr);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-[#d6d0c4] bg-white px-3 py-1.5 text-xs font-medium text-[#3a414f] hover:bg-[#f7f4ef]"
      >
        Merge fields
      </button>
      {open ? (
        <div className="absolute z-20 mt-2 w-80 rounded-lg border border-[#e5e0d6] bg-white p-3 shadow-lg">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search contact, account, owner…"
            className="mb-2 w-full rounded-md border border-[#e5e0d6] px-2 py-1.5 text-sm"
          />
          <div className="max-h-64 space-y-3 overflow-auto">
            {groups.map(([object, rows]) => (
              <div key={object}>
                <p className="mb-1 text-[10px] font-semibold tracking-wider text-[#9ca3af] uppercase">
                  {object}
                </p>
                <ul className="space-y-0.5">
                  {rows.map((f) => (
                    <li key={`${f.object}.${f.api_name}`}>
                      <button
                        type="button"
                        className="w-full rounded px-2 py-1 text-left text-sm hover:bg-[#f3efe6]"
                        onClick={() => {
                          onInsert(f.insert_token);
                          setOpen(false);
                        }}
                      >
                        {f.label}
                        <span className="ml-2 text-xs text-[#9ca3af]">
                          {f.insert_token}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
