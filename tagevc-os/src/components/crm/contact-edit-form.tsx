'use client';

import { useState, useTransition } from 'react';
import { actionPatchContact } from '@/app/(app)/shared-services/crm/actions';

export function ContactEditForm(props: {
  contactId: string;
  initial: {
    full_name: string;
    primary_email: string | null;
    title: string | null;
    department: string | null;
    location: string | null;
    linkedin_url: string | null;
  };
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <form
      className="space-y-3 rounded-md border border-border p-4 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const fields: Record<string, string | null> = {
          full_name: String(fd.get('full_name') || '') || null,
          primary_email: String(fd.get('primary_email') || '') || null,
          title: String(fd.get('title') || '') || null,
          department: String(fd.get('department') || '') || null,
          location: String(fd.get('location') || '') || null,
          linkedin_url: String(fd.get('linkedin_url') || '') || null,
        };
        start(async () => {
          const r = await actionPatchContact(props.contactId, fields);
          setMsg(r.ok ? 'Saved (user-locked provenance)' : r.error);
        });
      }}
    >
      <h2 className="font-semibold">Edit (locks fields as user)</h2>
      {(
        [
          ['full_name', 'Full name'],
          ['primary_email', 'Email'],
          ['title', 'Title'],
          ['department', 'Department'],
          ['location', 'Location'],
          ['linkedin_url', 'LinkedIn URL'],
        ] as const
      ).map(([name, label]) => (
        <label key={name} className="block">
          <span className="text-xs text-muted-foreground">{label}</span>
          <input
            name={name}
            defaultValue={props.initial[name] ?? ''}
            className="mt-1 w-full rounded-md border border-border px-3 py-2"
          />
        </label>
      ))}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[#1B2838] px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save'}
      </button>
      {msg ? <p className="text-xs text-muted-foreground">{msg}</p> : null}
    </form>
  );
}
