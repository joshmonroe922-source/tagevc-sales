'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { NormalizationStatus } from '@/lib/data/normalization-status';

export function NormalizationHealthPanel({
  status,
}: {
  status: NormalizationStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const gates = status.write_cutover.snapshot_write_gates;
  const ready = status.write_cutover.archive_ready_collections;

  function archiveReady() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/snapshot-archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            only_cutover: true,
            note: 'admin UI soft-archive',
          }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          error?: string;
          results?: Array<{ collection: string; ok: boolean; skipped?: boolean }>;
        };
        if (!res.ok || !data.ok) {
          setError(data.error ?? 'Archive failed');
          return;
        }
        const summary = (data.results ?? [])
          .map((r) => `${r.collection}:${r.skipped ? 'skipped' : 'archived'}`)
          .join(', ');
        setMessage(summary || 'Archive complete');
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Archive failed');
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Stage · {status.cutover_hints.stage}</Badge>
        <Badge variant="secondary">
          Sync failures · {status.sync_failure_count}
        </Badge>
        <Badge variant="outline">
          Master · {status.master_data_source}
        </Badge>
        <Badge variant={status.sentry_configured ? 'secondary' : 'outline'}>
          Sentry · {status.sentry_configured ? 'on' : 'off'}
        </Badge>
      </div>

      <p className="text-sm text-muted-foreground">{status.cutover_hints.next}</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Snapshot write gates</CardTitle>
            <CardDescription>
              allow=false means SQL-first (snapshot writes suppressed).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {Object.entries(gates).map(([domain, gate]) => (
              <div
                key={domain}
                className="flex items-center justify-between gap-2 border-b border-border/60 py-1.5 last:border-0"
              >
                <span className="font-medium">{domain}</span>
                <span className="text-muted-foreground">
                  {gate.allow ? 'writing' : 'skipped'} · {gate.reason}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cutover flags</CardTitle>
            <CardDescription>Current process env (Vercel).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row
              label="WRITE_CUTOVER_MATURE"
              value={String(status.write_cutover.write_cutover_mature)}
            />
            <Row
              label="WRITE_CUTOVER_ALL"
              value={String(status.write_cutover.write_cutover_all)}
            />
            <Row
              label="WRITE_SNAPSHOTS"
              value={
                status.write_cutover.write_snapshots_enabled ? 'on' : 'off'
              }
            />
            <Row
              label="Archive table"
              value={
                status.write_cutover.archive_table_ready ? 'ready' : 'missing'
              }
            />
            <Row
              label="Ready to archive"
              value={ready.length ? ready.join(', ') : '—'}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Soft-archive snapshots</CardTitle>
          <CardDescription>
            Copies live payload into{' '}
            <code className="text-xs">os_store_snapshot_archive</code>, then
            clears the live row to {'{}'}. Only collections with write cutover
            active. Reversible via SQL restore from archive.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            type="button"
            disabled={pending || ready.length === 0}
            onClick={archiveReady}
          >
            {pending
              ? 'Archiving…'
              : ready.length
                ? `Archive ${ready.length} cut-over collection(s)`
                : 'Enable cutover env first'}
          </Button>
          {message ? (
            <p className="text-sm text-emerald-700" role="status">
              {message}
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Row counts</CardTitle>
          </CardHeader>
          <CardContent className="max-h-72 space-y-1 overflow-auto text-sm">
            {Object.entries(status.row_counts)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([domain, count]) => (
                <div
                  key={domain}
                  className="flex justify-between gap-2 border-b border-border/40 py-1"
                >
                  <span>{domain}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {count}
                  </span>
                </div>
              ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Live snapshots</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {status.snapshots.length === 0 ? (
              <p className="text-muted-foreground">No snapshot rows</p>
            ) : (
              status.snapshots.map((s) => (
                <div
                  key={s.collection}
                  className="flex justify-between gap-2 border-b border-border/40 py-1"
                >
                  <span>
                    {s.collection}
                    {s.payload_empty ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        empty
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(s.updated_at).toLocaleString()}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {status.recent_archives && status.recent_archives.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent archives</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {status.recent_archives.map((a) => (
              <div
                key={a.id}
                className="flex justify-between gap-2 border-b border-border/40 py-1"
              >
                <span>
                  {a.collection}
                  {a.note ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {a.note}
                    </span>
                  ) : null}
                </span>
                <span className="text-muted-foreground">
                  {new Date(a.archived_at).toLocaleString()}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/50 py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[60%] truncate text-right font-medium">{value}</span>
    </div>
  );
}
