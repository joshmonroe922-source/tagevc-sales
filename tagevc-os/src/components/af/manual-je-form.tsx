'use client';

import { useState, useTransition } from 'react';
import {
  actionPostDraftJe,
  actionPostManualJe,
} from '@/app/(app)/shared-services/af/actions';
import type { EntityCode } from '@/lib/af/types';

type CoaOption = { number: string; name: string };
type DraftRow = {
  id: string;
  memo: string;
  date: string;
  status: string;
};

export function ManualJeForm({
  entityCode,
  coa,
  drafts,
}: {
  entityCode: EntityCode;
  coa: CoaOption[];
  drafts: DraftRow[];
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState('');
  const [debitAcct, setDebitAcct] = useState(coa[0]?.number ?? '6500');
  const [creditAcct, setCreditAcct] = useState('1000');
  const [amount, setAmount] = useState('');
  const [asDraft, setAsDraft] = useState(false);

  return (
    <div className="space-y-4 rounded-xl border border-border p-4">
      <div>
        <h2 className="font-heading font-semibold text-[#3a414f]">Manual journal</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Balanced two-line entry for {entityCode}. Draft saves without updating
          balances; Post writes to GL.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 rounded-md border border-border bg-white px-2 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Amount
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="h-9 rounded-md border border-border bg-white px-2 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2">
          Memo
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Adjustment description"
            className="h-9 rounded-md border border-border bg-white px-2 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Debit account
          <select
            value={debitAcct}
            onChange={(e) => setDebitAcct(e.target.value)}
            className="h-9 rounded-md border border-border bg-white px-2 text-sm text-foreground"
          >
            {coa.map((a) => (
              <option key={`d-${a.number}`} value={a.number}>
                {a.number} · {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Credit account
          <select
            value={creditAcct}
            onChange={(e) => setCreditAcct(e.target.value)}
            className="h-9 rounded-md border border-border bg-white px-2 text-sm text-foreground"
          >
            {coa.map((a) => (
              <option key={`c-${a.number}`} value={a.number}>
                {a.number} · {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={asDraft}
            onChange={(e) => setAsDraft(e.target.checked)}
          />
          Save as draft
        </label>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const amt = Number(amount);
              if (!Number.isFinite(amt) || amt <= 0) {
                setMsg('Enter a positive amount');
                return;
              }
              if (!memo.trim()) {
                setMsg('Memo required');
                return;
              }
              if (debitAcct === creditAcct) {
                setMsg('Debit and credit accounts must differ');
                return;
              }
              const r = await actionPostManualJe({
                entityCode,
                date,
                memo: memo.trim(),
                status: asDraft ? 'draft' : 'posted',
                lines: [
                  { account: debitAcct, debit: amt, credit: 0 },
                  { account: creditAcct, debit: 0, credit: amt },
                ],
              });
              if (r.ok) {
                setMsg(`${r.status === 'draft' ? 'Draft' : 'Posted'} ${r.journalId}`);
                setAmount('');
                setMemo('');
              } else {
                setMsg(r.error ?? 'Failed');
              }
            })
          }
          className="inline-flex h-9 items-center rounded-md bg-[#3a414f] px-3 text-sm font-medium text-white hover:bg-[#2f3540] disabled:opacity-60"
        >
          {pending ? 'Saving…' : asDraft ? 'Save draft' : 'Post JE'}
        </button>
        {msg ? (
          <span className="text-xs text-muted-foreground">{msg}</span>
        ) : null}
      </div>

      {drafts.length > 0 ? (
        <div className="border-t border-border pt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Drafts
          </p>
          <ul className="mt-2 space-y-2 text-sm">
            {drafts.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span>
                  {d.memo}{' '}
                  <span className="text-xs text-muted-foreground">
                    · {d.date}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await actionPostDraftJe(d.id);
                      setMsg(r.ok ? `Posted ${r.journalId}` : r.error ?? 'Failed');
                    })
                  }
                  className="inline-flex h-8 items-center rounded-md border border-border px-2 text-xs font-medium hover:bg-muted/40 disabled:opacity-60"
                >
                  Post draft
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
