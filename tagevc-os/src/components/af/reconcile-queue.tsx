'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  actionAutoPostHighConfidence,
  actionCategorizeFeedTxn,
  actionConfirmFeedBill,
  actionExcludeFeedTxn,
  actionMatchFeeds,
  actionRunCategorization,
  actionSyncAllLiveFeeds,
} from '@/app/(app)/shared-services/af/actions';

export type ReconcileFeedRow = {
  id: string;
  date: string;
  description: string;
  amount: number;
  entityCode: string;
  bankAccountId: string;
  status: string;
  suggestedAccount?: string;
  suggestedConfidence?: number;
  matchedPaymentId?: string;
  journalId?: string;
  excludedReason?: string;
};

export type CoaOption = { number: string; name: string; type: string };
export type BillOption = {
  id: string;
  number: string;
  vendorName: string;
  entityCode: string;
  remaining: number;
};

function MoneyInline({ value }: { value: number }) {
  return (
    <span className="tabular-nums">
      {new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 2,
      }).format(value)}
    </span>
  );
}

export function ReconcileQueue({
  matched,
  exceptions,
  excluded,
  coaByEntity,
  openBills,
}: {
  matched: ReconcileFeedRow[];
  exceptions: ReconcileFeedRow[];
  excluded: ReconcileFeedRow[];
  coaByEntity: Record<string, CoaOption[]>;
  openBills: BillOption[];
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [accountPick, setAccountPick] = useState<Record<string, string>>({});
  const [billPick, setBillPick] = useState<Record<string, string>>({});
  const [learn, setLearn] = useState<Record<string, boolean>>({});

  const coaFor = (entityCode: string, amount: number) => {
    const all = coaByEntity[entityCode] ?? [];
    if (amount < 0) {
      return all.filter(
        (a) =>
          a.type === 'Expense' ||
          a.type === 'Other Expense' ||
          a.number.startsWith('5') ||
          a.number.startsWith('6') ||
          a.number.startsWith('7') ||
          a.number.startsWith('8'),
      );
    }
    return all.filter(
      (a) =>
        a.type === 'Revenue' ||
        a.type === 'Other Income' ||
        a.number.startsWith('4') ||
        a.number.startsWith('7'),
    );
  };

  const billsFor = (entityCode: string, amount: number) =>
    openBills.filter(
      (b) =>
        b.entityCode === entityCode &&
        Math.abs(b.remaining - Math.abs(amount)) < Math.max(1, b.remaining * 0.05) + 50,
    );

  const run = (fn: () => Promise<void>) => {
    start(async () => {
      try {
        await fn();
      } catch (e) {
        setMsg(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const toolbar = useMemo(
    () => (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const r = await actionSyncAllLiveFeeds();
              setMsg(r.message);
            })
          }
          className="inline-flex h-9 items-center rounded-md bg-[#3a414f] px-3 text-sm font-medium text-white hover:bg-[#2f3540] disabled:opacity-60"
        >
          Sync + process
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const r = await actionMatchFeeds();
              setMsg(`Matched ${r.matched} · suggestions ${r.suggested}`);
            })
          }
          className="inline-flex h-9 items-center rounded-md border border-border bg-white px-3 text-sm font-medium hover:bg-muted/40 disabled:opacity-60"
        >
          Auto-match
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const r = await actionRunCategorization();
              setMsg(`Updated ${r.updated} suggestion(s)`);
            })
          }
          className="inline-flex h-9 items-center rounded-md border border-border bg-white px-3 text-sm font-medium hover:bg-muted/40 disabled:opacity-60"
        >
          Run rules
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const r = await actionAutoPostHighConfidence();
              setMsg(
                `Auto-posted ${r.posted}${
                  r.errors.length ? ` · ${r.errors.length} error(s)` : ''
                }`,
              );
            })
          }
          className="inline-flex h-9 items-center rounded-md border border-border bg-white px-3 text-sm font-medium hover:bg-muted/40 disabled:opacity-60"
        >
          Auto-post ≥85%
        </button>
        {msg ? (
          <span className="text-xs text-muted-foreground">{msg}</span>
        ) : null}
      </div>
    ),
    [pending, msg],
  );

  return (
    <div className="space-y-6">
      {toolbar}

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
          Exceptions ({exceptions.length})
        </h2>
        {exceptions.length === 0 ? (
          <p className="rounded-xl border border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
            Clear — exception-only review. All feed rows matched, categorized, or
            excluded.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <ul className="divide-y divide-border/60">
              {exceptions.map((t) => {
                const accounts = coaFor(t.entityCode, t.amount);
                const bills = billsFor(t.entityCode, t.amount);
                const selected =
                  accountPick[t.id] ?? t.suggestedAccount ?? accounts[0]?.number ?? '';
                const selectedBill = billPick[t.id] ?? bills[0]?.id ?? '';
                const conf = t.suggestedConfidence
                  ? Math.round(t.suggestedConfidence * 100)
                  : null;
                return (
                  <li key={t.id} className="space-y-3 px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-[#3a414f]">{t.description}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t.date} · {t.entityCode} · {t.bankAccountId}
                          {t.suggestedAccount
                            ? ` · suggest ${t.suggestedAccount}${
                                conf != null ? ` (${conf}%)` : ''
                              }`
                            : ''}
                        </p>
                      </div>
                      <MoneyInline value={t.amount} />
                    </div>

                    <div className="flex flex-wrap items-end gap-2">
                      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                        CoA
                        <select
                          className="h-9 min-w-[12rem] rounded-md border border-border bg-white px-2 text-sm text-foreground"
                          value={selected}
                          onChange={(e) =>
                            setAccountPick((m) => ({
                              ...m,
                              [t.id]: e.target.value,
                            }))
                          }
                        >
                          {accounts.map((a) => (
                            <option key={a.number} value={a.number}>
                              {a.number} · {a.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex items-center gap-1.5 pb-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={!!learn[t.id]}
                          onChange={(e) =>
                            setLearn((m) => ({
                              ...m,
                              [t.id]: e.target.checked,
                            }))
                          }
                        />
                        Learn rule
                      </label>
                      <button
                        type="button"
                        disabled={pending || !selected}
                        onClick={() =>
                          run(async () => {
                            const r = await actionCategorizeFeedTxn({
                              feedTxnId: t.id,
                              account: selected,
                              learnRule: !!learn[t.id],
                            });
                            setMsg(
                              r.ok
                                ? `Posted ${r.journalId}`
                                : r.error ?? 'Failed',
                            );
                          })
                        }
                        className="inline-flex h-9 items-center rounded-md bg-[#3a414f] px-3 text-sm font-medium text-white hover:bg-[#2f3540] disabled:opacity-60"
                      >
                        {t.suggestedAccount && selected === t.suggestedAccount
                          ? 'Accept & post'
                          : 'Categorize & post'}
                      </button>

                      {t.amount < 0 && bills.length > 0 ? (
                        <>
                          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                            Open bill
                            <select
                              className="h-9 min-w-[12rem] rounded-md border border-border bg-white px-2 text-sm text-foreground"
                              value={selectedBill}
                              onChange={(e) =>
                                setBillPick((m) => ({
                                  ...m,
                                  [t.id]: e.target.value,
                                }))
                              }
                            >
                              {bills.map((b) => (
                                <option key={b.id} value={b.id}>
                                  {b.number} · {b.vendorName} (
                                  {b.remaining.toFixed(0)})
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            disabled={pending || !selectedBill}
                            onClick={() =>
                              run(async () => {
                                const r = await actionConfirmFeedBill({
                                  feedTxnId: t.id,
                                  billId: selectedBill,
                                });
                                setMsg(
                                  r.ok
                                    ? `Bill paid · ${r.paymentId}`
                                    : r.error ?? 'Failed',
                                );
                              })
                            }
                            className="inline-flex h-9 items-center rounded-md border border-border bg-white px-3 text-sm font-medium hover:bg-muted/40 disabled:opacity-60"
                          >
                            Confirm bill
                          </button>
                        </>
                      ) : null}

                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          run(async () => {
                            const r = await actionExcludeFeedTxn(
                              t.id,
                              'Excluded from reconcile',
                            );
                            setMsg(
                              r.ok ? 'Excluded' : r.error ?? 'Failed',
                            );
                          })
                        }
                        className="inline-flex h-9 items-center rounded-md border border-border bg-white px-3 text-sm font-medium text-muted-foreground hover:bg-muted/40 disabled:opacity-60"
                      >
                        Exclude
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-border p-4">
          <h2 className="font-heading font-semibold text-[#3a414f]">
            Matched ({matched.length})
          </h2>
          <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto text-sm">
            {matched.map((t) => (
              <li
                key={t.id}
                className="flex justify-between gap-2 border-b border-border/50 py-2"
              >
                <span className="min-w-0 truncate">
                  <span className="block truncate">{t.description}</span>
                  <span className="text-xs text-muted-foreground">
                    {t.matchedPaymentId
                      ? `Payment ${t.matchedPaymentId}`
                      : t.journalId
                        ? `JE ${t.journalId}`
                        : t.date}
                  </span>
                </span>
                <MoneyInline value={t.amount} />
              </li>
            ))}
            {matched.length === 0 && (
              <li className="text-muted-foreground">None yet</li>
            )}
          </ul>
        </section>
        <section className="rounded-xl border border-border p-4">
          <h2 className="font-heading font-semibold text-[#3a414f]">
            Excluded ({excluded.length})
          </h2>
          <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto text-sm">
            {excluded.map((t) => (
              <li
                key={t.id}
                className="flex justify-between gap-2 border-b border-border/50 py-2"
              >
                <span className="min-w-0 truncate">
                  <span className="block truncate">{t.description}</span>
                  <span className="text-xs text-muted-foreground">
                    {t.excludedReason ?? 'Excluded'}
                  </span>
                </span>
                <MoneyInline value={t.amount} />
              </li>
            ))}
            {excluded.length === 0 && (
              <li className="text-muted-foreground">None</li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
