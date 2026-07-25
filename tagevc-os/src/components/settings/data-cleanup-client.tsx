'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  executeDemoCleanupAction,
  inventoryDemoDataAction,
} from '@/app/(app)/settings/data-cleanup/actions';
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
  CLEANUP_CONFIRM_PHRASE,
  type CleanupInventory,
  type DemoDomain,
} from '@/lib/admin/demo-data-cleanup-shared';

const DOMAIN_OPTIONS: Array<{ id: DemoDomain; label: string }> = [
  { id: 'leads_sample', label: 'Sample leads' },
  { id: 'tickets_seed', label: 'Seed tickets' },
  { id: 'hris_sample', label: 'Sample HRIS employees' },
  { id: 'entities_sample', label: 'Sample entities (review only)' },
  { id: 'portfolio_sample', label: 'Sample portfolio (review only)' },
];

export function DataCleanupClient({ canWrite }: { canWrite: boolean }) {
  const [pending, start] = useTransition();
  const [inventory, setInventory] = useState<CleanupInventory | null>(null);
  const [selected, setSelected] = useState<DemoDomain[]>([
    'leads_sample',
    'tickets_seed',
  ]);
  const [phrase, setPhrase] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [lastActions, setLastActions] = useState<string[]>([]);

  const refresh = () =>
    start(async () => {
      const res = await inventoryDemoDataAction();
      if (res.ok) setInventory(res.inventory);
      else setMessage(res.error);
    });

  useEffect(() => {
    refresh();
  }, []);

  const toggle = (id: DemoDomain) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Demo data inventory</CardTitle>
          <CardDescription>
            Read-only counts of synthetic/sample rows. Real users, Recruit 619,
            Instant NDA, and integration settings are protected.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button size="sm" variant="outline" disabled={pending} onClick={refresh}>
            Refresh inventory
          </Button>
          {inventory ? (
            <ul className="space-y-2 text-sm">
              {inventory.domains.map((d) => (
                <li
                  key={d.domain}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                >
                  <span>{d.label}</span>
                  <Badge variant="secondary">{d.count}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
          {inventory ? (
            <div className="space-y-1 text-xs text-muted-foreground">
              {inventory.protected_notes.map((n) => (
                <p key={n}>• {n}</p>
              ))}
              {inventory.recruit_inda_notes.map((n) => (
                <p key={n}>• {n}</p>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Controlled cleanup</CardTitle>
            <CardDescription>
              Defaults to dry-run. Destructive execute also requires env
              CONFIRM_CLEANUP=yes and the phrase below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {DOMAIN_OPTIONS.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(d.id)}
                    onChange={() => toggle(d.id)}
                  />
                  {d.label}
                </label>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phrase">
                Type {CLEANUP_CONFIRM_PHRASE} to enable execute
              </Label>
              <Input
                id="phrase"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder={CLEANUP_CONFIRM_PHRASE}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={pending || selected.length === 0}
                onClick={() =>
                  start(async () => {
                    const res = await executeDemoCleanupAction({
                      domains: selected,
                      confirm_phrase: CLEANUP_CONFIRM_PHRASE,
                      dry_run: true,
                    });
                    if (!res.ok || !('actions' in res)) {
                      setMessage(res.error ?? 'Failed');
                      setLastActions([]);
                    } else {
                      setMessage(
                        `Dry-run complete (${res.actions.length} actions)`,
                      );
                      setLastActions(res.actions);
                    }
                    refresh();
                  })
                }
              >
                Dry-run
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={
                  pending ||
                  selected.length === 0 ||
                  phrase !== CLEANUP_CONFIRM_PHRASE
                }
                onClick={() =>
                  start(async () => {
                    if (
                      !window.confirm(
                        'Execute demo cleanup? This archives/closes sample rows only.',
                      )
                    ) {
                      return;
                    }
                    const res = await executeDemoCleanupAction({
                      domains: selected,
                      confirm_phrase: phrase,
                      dry_run: false,
                    });
                    if (!res.ok || !('actions' in res)) {
                      setMessage(res.error ?? 'Failed');
                      setLastActions([]);
                    } else {
                      setMessage(
                        res.dry_run
                          ? `Blocked (still dry-run): ${res.error ?? 'set CONFIRM_CLEANUP=yes'}`
                          : `Cleanup executed (${res.actions.length} actions)`,
                      );
                      setLastActions(res.actions);
                    }
                    refresh();
                  })
                }
              >
                Execute cleanup
              </Button>
            </div>
            {message ? (
              <p className="text-xs text-muted-foreground">{message}</p>
            ) : null}
            {lastActions.length > 0 ? (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {lastActions.map((a) => (
                  <li key={a}>• {a}</li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
