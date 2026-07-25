'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  importBusinessCreditReportAction,
  saveBusinessBureauManualAction,
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
import {
  BUSINESS_BUREAUS,
  BUSINESS_BUREAU_LABELS,
  BUSINESS_BUREAU_PORTALS,
  bureauCardStatus,
  primaryBureauIdentifier,
  primaryBusinessScore,
  type BusinessBureau,
  type BusinessBureauCompany,
} from '@/lib/net-worth/business-credit-types';

const STATUS_BADGE: Record<
  'healthy' | 'attention' | 'no_data',
  { label: string; variant: 'secondary' | 'destructive' | 'outline' }
> = {
  healthy: { label: 'Healthy', variant: 'secondary' },
  attention: { label: 'Attention', variant: 'destructive' },
  no_data: { label: 'No data', variant: 'outline' },
};

const MANUAL_FIELDS: Record<
  BusinessBureau,
  { id: string; primary: string; secondary: string }
> = {
  dnb: {
    id: 'D-U-N-S number',
    primary: 'PAYDEX (1–100)',
    secondary: 'Failure score (1001–1875)',
  },
  experian_business: {
    id: 'Experian file / BIN #',
    primary: 'Intelliscore Plus (1–100)',
    secondary: 'Financial stability risk (1–100)',
  },
  equifax_business: {
    id: 'Equifax business ID',
    primary: 'Business credit risk (101–992)',
    secondary: 'Business failure score (1000–1880)',
  },
};

export function BusinessBureauClient({
  companies,
  alerts,
  loadError,
}: {
  companies: BusinessBureauCompany[];
  alerts: Array<{ entity_id: string; company_name: string; message: string }>;
  loadError?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState(companies[0]?.entity_id ?? '');
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelBureau, setPanelBureau] = useState<BusinessBureau>('dnb');
  const [pasteText, setPasteText] = useState('');
  const [manualId, setManualId] = useState('');
  const [manualPrimary, setManualPrimary] = useState('');
  const [manualSecondary, setManualSecondary] = useState('');
  const [manualDate, setManualDate] = useState('');

  const company = companies.find((c) => c.entity_id === selected) ?? null;

  const openPanel = (bureau: BusinessBureau) => {
    setPanelBureau(bureau);
    setPasteText('');
    setManualId('');
    setManualPrimary('');
    setManualSecondary('');
    setManualDate('');
    setPanelOpen(true);
  };

  const upload = (file: File | null) => {
    if (!company || !file) {
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
      const res = await importBusinessCreditReportAction({
        entityId: company.entity_id,
        bureau: panelBureau,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64,
        pasteText: pasteText.trim() || undefined,
      });
      setMessage(res.ok ? res.message : res.error);
      if (res.ok) setPanelOpen(false);
      router.refresh();
    });
  };

  const saveManual = () => {
    if (!company) return;
    start(async () => {
      const res = await saveBusinessBureauManualAction({
        entityId: company.entity_id,
        bureau: panelBureau,
        identifier: manualId,
        primaryScore: manualPrimary,
        secondaryScore: manualSecondary,
        reportDate: manualDate,
      });
      setMessage(res.ok ? res.message : res.error);
      if (res.ok) setPanelOpen(false);
      router.refresh();
    });
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-heading text-lg font-semibold text-[#3a414f]">
            Bureau reports (D&amp;B · Experian Business · Equifax Business)
          </h3>
          <p className="text-sm text-muted-foreground">
            Guided human-gated import per company · no scraping, no stored
            passwords, no fake scores
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => openPanel('dnb')}
          disabled={!company}
        >
          Business bureau connections &amp; import
        </Button>
      </div>

      {loadError ? (
        <p className="text-sm text-muted-foreground">
          Bureau tables unavailable until Phase 75 SQL is applied: {loadError}
        </p>
      ) : null}
      {message ? (
        <p className="text-xs text-muted-foreground">{message}</p>
      ) : null}

      {alerts.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Bureau alerts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {alerts.slice(0, 10).map((a, idx) => (
              <p key={`${a.entity_id}-${idx}`}>
                <span className="font-medium">{a.company_name}</span> —{' '}
                {a.message}
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {companies.map((c) => (
          <button
            key={c.entity_id}
            type="button"
            className={
              selected === c.entity_id
                ? 'rounded-md bg-[#3a414f] px-3 py-1.5 text-sm text-white'
                : 'rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground'
            }
            onClick={() => setSelected(c.entity_id)}
          >
            {c.company_name}
          </button>
        ))}
      </div>

      {company ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {BUSINESS_BUREAUS.map((bureau) => {
            const snap = company.byBureau[bureau] ?? null;
            const status = STATUS_BADGE[bureauCardStatus(snap)];
            const id = primaryBureauIdentifier(bureau, snap?.identifiers ?? {});
            const score = primaryBusinessScore(bureau, snap?.scores ?? {});
            return (
              <Card key={bureau}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between gap-2 text-base">
                    {BUSINESS_BUREAU_LABELS[bureau]}
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </CardTitle>
                  <CardDescription>
                    {id.value ? `${id.label} ${id.value}` : `${id.label} not on file`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="rounded-md border border-border px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {score.label}
                    </p>
                    <p className="font-heading text-2xl font-semibold tabular-nums">
                      {score.value ?? '—'}
                    </p>
                  </div>
                  {snap ? (
                    <p className="text-xs text-muted-foreground">
                      Updated {snap.pulled_at.slice(0, 10)} ({snap.days_old}d ago)
                      {snap.stale ? ' · stale' : ''} · {snap.source}
                      {snap.summary.public_records != null
                        ? ` · public records ${snap.summary.public_records}`
                        : ''}
                      {snap.summary.tradelines_count != null
                        ? ` · tradelines ${snap.summary.tradelines_count}`
                        : ''}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No snapshots yet — run a guided import.
                    </p>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openPanel(bureau)}
                    disabled={pending}
                  >
                    Guided import
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No business credit companies yet — apply Phase 73 SQL first.
        </p>
      )}

      {/* Import side panel */}
      {panelOpen && company ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
          <div className="h-full w-full max-w-md overflow-y-auto border-l border-border bg-background p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-heading text-lg font-semibold">
                Business bureau connections &amp; import
              </h3>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPanelOpen(false)}
              >
                Close
              </Button>
            </div>

            <div className="space-y-4 text-sm">
              <p className="font-medium">{company.company_name}</p>

              {company.connections.length > 0 ? (
                <div className="space-y-2">
                  {company.connections.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-md border border-border px-3 py-2"
                    >
                      <div className="flex justify-between gap-2">
                        <span>{BUSINESS_BUREAU_LABELS[c.bureau]}</span>
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
                </div>
              ) : null}

              <div className="space-y-2">
                <Label>Bureau</Label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2"
                  value={panelBureau}
                  onChange={(e) =>
                    setPanelBureau(e.target.value as BusinessBureau)
                  }
                >
                  {BUSINESS_BUREAUS.map((b) => (
                    <option key={b} value={b}>
                      {BUSINESS_BUREAU_LABELS[b]}
                    </option>
                  ))}
                </select>
              </div>

              <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
                <li>
                  Open{' '}
                  <a
                    href={BUSINESS_BUREAU_PORTALS[panelBureau]}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {BUSINESS_BUREAU_LABELS[panelBureau]}
                  </a>{' '}
                  in a new tab and sign in yourself.
                </li>
                <li>
                  Download the latest business credit report / PDF / export for{' '}
                  {company.company_name}.
                </li>
                <li>Return here and upload it (optional: paste text).</li>
              </ol>

              <div className="space-y-1.5">
                <Label htmlFor="biz-paste">
                  Optional text paste (helps parse)
                </Label>
                <textarea
                  id="biz-paste"
                  className="min-h-24 w-full rounded-md border border-input bg-background p-2 text-sm"
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder="Paste score summary if PDF text extract is weak…"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="biz-file">Report file (PDF preferred)</Label>
                <Input
                  id="biz-file"
                  type="file"
                  accept=".pdf,.txt,.csv,application/pdf,text/plain,text/csv"
                  onChange={(e) => upload(e.target.files?.[0] ?? null)}
                  disabled={pending}
                />
              </div>

              <div className="space-y-2 rounded-md border border-border p-3">
                <p className="font-medium">
                  Manual entry (when parse is incomplete)
                </p>
                <p className="text-xs text-muted-foreground">
                  Stored with a clear “manual” source flag. Only enter values
                  from a real report — no fake scores.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="manual-id">
                    {MANUAL_FIELDS[panelBureau].id}
                  </Label>
                  <Input
                    id="manual-id"
                    value={manualId}
                    onChange={(e) => setManualId(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="manual-primary">
                    {MANUAL_FIELDS[panelBureau].primary}
                  </Label>
                  <Input
                    id="manual-primary"
                    type="number"
                    value={manualPrimary}
                    onChange={(e) => setManualPrimary(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="manual-secondary">
                    {MANUAL_FIELDS[panelBureau].secondary}
                  </Label>
                  <Input
                    id="manual-secondary"
                    type="number"
                    value={manualSecondary}
                    onChange={(e) => setManualSecondary(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="manual-date">Report date</Label>
                  <Input
                    id="manual-date"
                    type="date"
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                  />
                </div>
                <Button size="sm" onClick={saveManual} disabled={pending}>
                  Save manual entry
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
