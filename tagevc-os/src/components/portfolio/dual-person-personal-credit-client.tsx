'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import {
  importPersonalCreditReportAction,
  sendCreditGrokAction,
} from '@/app/(app)/portfolio/net-worth/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FICO_REVIEW_STARTER } from '@/lib/net-worth/credit-grok-constants';
import type {
  CreditAlert,
  CreditConnection,
  CreditGrokMessageDto,
  CreditSnapshot,
  CreditSubject,
  PersonKey,
} from '@/lib/net-worth/credit-types';

type PersonBundle = {
  subject: CreditSubject;
  latest: CreditSnapshot | null;
  history: CreditSnapshot[];
  connections: CreditConnection[];
  scoreTrend8: number[];
  scoreTrend10: number[];
};

function ScoreBig({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="font-heading text-2xl font-semibold tabular-nums">
        {value ?? '—'}
      </p>
    </div>
  );
}

function MiniSpark({ values }: { values: number[] }) {
  if (values.length < 2) {
    return (
      <span className="text-xs text-muted-foreground">Need 2+ snapshots</span>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 80;
      const y = 20 - ((v - min) / span) * 16;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg width="84" height="24" viewBox="0 0 84 24" aria-hidden>
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        points={pts}
      />
    </svg>
  );
}

export function DualPersonPersonalCreditClient({
  byPerson,
  alerts,
  grokMessages,
  loadError,
}: {
  byPerson: Partial<Record<PersonKey, PersonBundle>>;
  alerts: CreditAlert[];
  grokMessages: CreditGrokMessageDto[];
  loadError?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<PersonKey>('josh_monroe');
  const [panelOpen, setPanelOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [provider, setProvider] = useState<'myfico' | 'experian' | 'manual_upload'>(
    'myfico',
  );
  const [pasteText, setPasteText] = useState('');
  const [grokInput, setGrokInput] = useState('');
  const [localGrok, setLocalGrok] = useState(grokMessages);

  const person = byPerson[tab];
  const people = useMemo(
    () =>
      (['josh_monroe', 'lauren_monroe'] as const)
        .map((k) => byPerson[k])
        .filter(Boolean) as PersonBundle[],
    [byPerson],
  );

  const upload = (file: File | null) => {
    if (!person || !file) {
      setMessage('Choose a file');
      return;
    }
    start(async () => {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result ?? '');
          const comma = result.indexOf(',');
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const res = await importPersonalCreditReportAction({
        subjectId: person.subject.id,
        displayName: person.subject.display_name,
        source: provider,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64,
        pasteText: pasteText.trim() || undefined,
      });
      setMessage(res.ok ? res.message : res.error);
      if (res.ok) {
        setPasteText('');
        setPanelOpen(false);
      }
      router.refresh();
    });
  };

  const sendGrok = (text: string) => {
    start(async () => {
      const res = await sendCreditGrokAction(text);
      if (!res.ok) {
        setMessage(res.error);
        return;
      }
      setLocalGrok((prev) => [
        ...prev,
        {
          id: `u-${Date.now()}`,
          role: 'user',
          content: text,
          model: null,
          created_at: new Date().toISOString(),
        },
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: res.reply,
          model: null,
          created_at: new Date().toISOString(),
        },
      ]);
      setGrokInput('');
      router.refresh();
    });
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-semibold text-[#3a414f]">
            Personal credit
          </h2>
          <p className="text-sm text-muted-foreground">
            Josh Monroe + Lauren Monroe · FICO 8 &amp; FICO 10 first · myFICO /
            Experian guided import · Visionary-only · hidden in Live Look
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setPanelOpen(true)}>
          Bureau connections &amp; import
        </Button>
      </div>

      {loadError ? (
        <p className="text-sm text-muted-foreground">
          Dual-person tables unavailable until Phase 74 SQL is applied:{' '}
          {loadError}
        </p>
      ) : null}
      {message ? (
        <p className="text-xs text-muted-foreground">{message}</p>
      ) : null}

      {alerts.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Alerts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {alerts.slice(0, 8).map((a) => (
              <p key={a.id}>{a.title}</p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {people.map((p) => (
          <button
            key={p.subject.person_key}
            type="button"
            className={
              tab === p.subject.person_key
                ? 'rounded-md bg-[#3a414f] px-3 py-1.5 text-sm text-white'
                : 'rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground'
            }
            onClick={() => setTab(p.subject.person_key)}
          >
            {p.subject.display_name}
            {p.latest?.stale ? ' · stale' : ''}
          </button>
        ))}
      </div>

      {person ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {person.subject.display_name}
            </CardTitle>
            <CardDescription>
              {person.subject.relationship === 'spouse'
                ? 'Household consent for personal financial management'
                : 'Self'}
              {person.latest
                ? ` · as of ${person.latest.pulled_at.slice(0, 10)} · ${person.latest.source}`
                : ' · no snapshots yet'}
              {person.latest?.stale ? (
                <Badge variant="destructive" className="ml-2">
                  Stale
                </Badge>
              ) : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <ScoreBig label="FICO 8" value={person.latest?.fico_8} />
              <ScoreBig label="FICO 10" value={person.latest?.fico_10} />
              <ScoreBig
                label="Auto 8"
                value={person.latest?.scores.fico_auto_8}
              />
              <ScoreBig
                label="Bankcard 8"
                value={person.latest?.scores.fico_bankcard_8}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
              <ScoreBig
                label="Auto 10"
                value={person.latest?.scores.fico_auto_10}
              />
              <ScoreBig
                label="Bankcard 10"
                value={person.latest?.scores.fico_bankcard_10}
              />
              <div className="rounded-md border border-border px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Utilization
                </p>
                <p className="font-heading text-xl font-semibold tabular-nums">
                  {person.latest?.summary.utilization_pct != null
                    ? `${person.latest.summary.utilization_pct}%`
                    : '—'}
                </p>
              </div>
              <div className="rounded-md border border-border px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Inquiries 12m
                </p>
                <p className="font-heading text-xl font-semibold tabular-nums">
                  {(person.latest?.summary.inquiries_12m as number) ?? '—'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="text-muted-foreground">FICO 8 trend</span>
              <MiniSpark values={person.scoreTrend8} />
              <span className="text-muted-foreground">FICO 10 trend</span>
              <MiniSpark values={person.scoreTrend10} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={pending}
                onClick={() => {
                  setProvider('myfico');
                  setPanelOpen(true);
                }}
              >
                Guided myFICO refresh
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setProvider('experian');
                  setPanelOpen(true);
                }}
              >
                Guided Experian refresh
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setProvider('manual_upload');
                  setPanelOpen(true);
                }}
              >
                Upload report
              </Button>
            </div>
            {person.history.length > 1 ? (
              <div className="text-xs text-muted-foreground">
                History: {person.history.length} snapshots · latest parse{' '}
                {person.latest?.parse_status}
                {person.latest?.parse_errors
                  ? ` · ${person.latest.parse_errors}`
                  : ''}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">
          Subjects not seeded — apply phase74_personal_credit_dual.sql.
        </p>
      )}

      {/* Import side panel */}
      {panelOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
          <div className="h-full w-full max-w-md overflow-y-auto border-l border-border bg-background p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-heading text-lg font-semibold">
                Bureau connections &amp; import
              </h3>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPanelOpen(false)}
              >
                Close
              </Button>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              Preferred: <strong>myFICO</strong> (exact FICO 8/10/Auto/Bankcard)
              then <strong>Experian paid</strong> (monitoring). No credential
              scraping — download PDF, return, upload.
            </p>
            {person ? (
              <div className="space-y-4 text-sm">
                <p className="font-medium">{person.subject.display_name}</p>
                {person.connections.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-md border border-border px-3 py-2"
                  >
                    <div className="flex justify-between gap-2">
                      <span className="capitalize">{c.provider}</span>
                      <Badge variant="outline">{c.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {c.notes || '—'}
                      {c.last_successful_pull_at
                        ? ` · last ${c.last_successful_pull_at.slice(0, 10)}`
                        : ''}
                    </p>
                  </div>
                ))}

                <div className="space-y-2">
                  <Label>Import source</Label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-2"
                    value={provider}
                    onChange={(e) =>
                      setProvider(
                        e.target.value as 'myfico' | 'experian' | 'manual_upload',
                      )
                    }
                  >
                    <option value="myfico">myFICO (recommended)</option>
                    <option value="experian">Experian paid (recommended)</option>
                    <option value="manual_upload">Other / annualcreditreport</option>
                  </select>
                </div>

                <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
                  <li>
                    Open{' '}
                    {provider === 'experian' ? (
                      <a
                        href="https://www.experian.com/"
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        Experian
                      </a>
                    ) : (
                      <a
                        href="https://www.myfico.com/"
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        myFICO
                      </a>
                    )}{' '}
                    in a new tab.
                  </li>
                  <li>
                    Download the latest 3-bureau / score summary PDF (Advanced or
                    Premier preferred on myFICO).
                  </li>
                  <li>Return here and upload the PDF (optional: paste text).</li>
                </ol>

                <div className="space-y-1.5">
                  <Label htmlFor="paste">Optional text paste (helps parse)</Label>
                  <textarea
                    id="paste"
                    className="min-h-24 w-full rounded-md border border-input bg-background p-2 text-sm"
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder="Paste score summary if PDF text extract is weak…"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="file">Report file (PDF preferred)</Label>
                  <Input
                    id="file"
                    type="file"
                    accept=".pdf,.txt,application/pdf,text/plain"
                    onChange={(e) => upload(e.target.files?.[0] ?? null)}
                    disabled={pending}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Grok Credit Advisor */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Grok Credit Advisor</CardTitle>
          <CardDescription>
            Visionary-only · biased to FICO 8 (primary) and FICO 10 (forward) ·
            educational only
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            size="sm"
            disabled={pending}
            onClick={() => sendGrok(FICO_REVIEW_STARTER)}
          >
            FICO 8 &amp; 10 review (starter)
          </Button>
          <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-border p-3 text-sm">
            {localGrok.length === 0 ? (
              <p className="text-muted-foreground">
                No thread yet — run the starter review after importing scores.
              </p>
            ) : (
              localGrok.map((m) => (
                <div key={m.id} className="space-y-0.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {m.role}
                  </p>
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
              ))
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              value={grokInput}
              onChange={(e) => setGrokInput(e.target.value)}
              placeholder="Ask about utilization, inquiries, FICO 10 levers…"
              className="flex-1"
            />
            <Button
              size="sm"
              disabled={pending || !grokInput.trim()}
              onClick={() => sendGrok(grokInput)}
            >
              Send
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
