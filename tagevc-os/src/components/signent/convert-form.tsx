'use client';

import { useState, useTransition } from 'react';
import { actionConvertSignentClient } from '@/app/(app)/shared-services/signent/actions';

export function SignentConvertForm() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <form
      className="grid gap-2 text-sm sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await actionConvertSignentClient({
            legalName: String(fd.get('legal_name') || ''),
            tradeName: String(fd.get('trade_name') || ''),
            productKeys: String(fd.get('products') || '')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
            invoiceRef: String(fd.get('invoice_ref') || '') || null,
            primaryContactEmail:
              String(fd.get('email') || '') || null,
            accountId: String(fd.get('account_id') || '') || null,
          });
          setMsg(
            r.ok
              ? `Created client ${r.clientOrg.id.slice(0, 8)}…`
              : r.error,
          );
          if (r.ok) {
            window.location.href = `/shared-services/signent/clients/${r.clientOrg.id}`;
          }
        });
      }}
    >
      <input
        name="legal_name"
        required
        placeholder="Legal name"
        className="rounded-md border border-border px-3 py-2"
      />
      <input
        name="trade_name"
        placeholder="Trade name"
        className="rounded-md border border-border px-3 py-2"
      />
      <input
        name="products"
        required
        placeholder="Product keys (comma-separated)"
        className="rounded-md border border-border px-3 py-2 sm:col-span-2"
      />
      <input
        name="email"
        type="email"
        placeholder="Primary contact email"
        className="rounded-md border border-border px-3 py-2"
      />
      <input
        name="invoice_ref"
        placeholder="Invoice / PO ref"
        className="rounded-md border border-border px-3 py-2"
      />
      <input
        name="account_id"
        placeholder="CRM account UUID (optional graph link)"
        className="rounded-md border border-border px-3 py-2 sm:col-span-2"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[#1B2838] px-3 py-2 text-xs font-medium text-white disabled:opacity-50 sm:col-span-2"
      >
        {pending ? 'Converting…' : 'Convert to active client'}
      </button>
      {msg ? (
        <p className="text-xs text-muted-foreground sm:col-span-2">{msg}</p>
      ) : null}
    </form>
  );
}
