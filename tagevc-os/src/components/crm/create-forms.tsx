'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  actionCreateAccount,
  actionCreateContact,
} from '@/app/(app)/shared-services/crm/actions';

export function CreateAccountForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <form
      className="space-y-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await actionCreateAccount(fd);
          if (!r.ok) {
            setErr(r.error);
            return;
          }
          setErr(null);
          router.push(`/shared-services/crm/accounts/${r.accountId}`);
        });
      }}
    >
      <input
        name="name"
        required
        placeholder="Company name"
        className="w-full rounded-md border border-border px-3 py-2"
      />
      <input
        name="domain"
        placeholder="domain.com"
        className="w-full rounded-md border border-border px-3 py-2"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[#1B2838] px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Creating…' : 'Create account'}
      </button>
      {err ? <p className="text-xs text-red-600">{err}</p> : null}
    </form>
  );
}

export function CreateContactForm({ accountId }: { accountId?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <form
      className="space-y-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        if (accountId) fd.set('account_id', accountId);
        start(async () => {
          const r = await actionCreateContact(fd);
          if (!r.ok) {
            setErr(r.error);
            return;
          }
          setErr(null);
          router.push(`/shared-services/crm/contacts/${r.contactId}`);
        });
      }}
    >
      <input
        name="full_name"
        required
        placeholder="Full name"
        className="w-full rounded-md border border-border px-3 py-2"
      />
      <input
        name="email"
        type="email"
        placeholder="email@company.com"
        className="w-full rounded-md border border-border px-3 py-2"
      />
      <input
        name="title"
        placeholder="Title"
        className="w-full rounded-md border border-border px-3 py-2"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[#1B2838] px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Creating…' : 'Create contact'}
      </button>
      {err ? <p className="text-xs text-red-600">{err}</p> : null}
    </form>
  );
}
