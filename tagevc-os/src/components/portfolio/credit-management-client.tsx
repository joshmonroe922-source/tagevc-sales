'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  addPersonalCreditItemAction,
  setPersonalActionStatusAction,
  updatePersonalCreditAction,
  upsertBusinessCreditAction,
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
import type {
  BusinessCreditProfile,
  PersonalCreditAction,
  PersonalCreditItem,
  PersonalCreditProfile,
} from '@/lib/net-worth/credit';

export function CreditManagementClient({
  showPersonal,
  personal,
  items,
  actions,
  coaching,
  showBusiness,
  businessProfiles,
  businessError,
  alerts,
  entityFilter,
}: {
  showPersonal: boolean;
  personal: PersonalCreditProfile | null;
  items: PersonalCreditItem[];
  actions: PersonalCreditAction[];
  coaching: string[];
  showBusiness: boolean;
  businessProfiles: BusinessCreditProfile[];
  businessError?: string;
  alerts: Array<{ entity_id: string; company_name: string; message: string }>;
  entityFilter: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState(
    entityFilter || businessProfiles[0]?.entity_id || 'ENT-FIRM',
  );
  const active = businessProfiles.find((p) => p.entity_id === selected);

  return (
    <div className="space-y-8">
      {message ? (
        <p className="text-xs text-muted-foreground">{message}</p>
      ) : null}

      {showPersonal && personal ? (
        <section className="space-y-4">
          <div>
            <h2 className="font-heading text-xl font-semibold text-[#3a414f]">
              Personal credit
            </h2>
            <p className="text-sm text-muted-foreground">
              Visionary-only · Experian / Equifax / TransUnion placeholders ·
              coaching only, not legal advice. Hidden during Live Look.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Bureau scores</CardTitle>
              <CardDescription>
                Manual entry until a connector is enabled. No fabricated scores.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-3 sm:grid-cols-3"
                action={(fd) =>
                  start(async () => {
                    const res = await updatePersonalCreditAction(fd);
                    setMessage(res.ok ? res.message : res.error);
                    router.refresh();
                  })
                }
              >
                <input type="hidden" name="profile_id" value={personal.id} />
                <div className="space-y-1.5">
                  <Label htmlFor="experian_score">Experian</Label>
                  <Input
                    id="experian_score"
                    name="experian_score"
                    type="number"
                    min={300}
                    max={850}
                    defaultValue={personal.experian_score ?? ''}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="equifax_score">Equifax</Label>
                  <Input
                    id="equifax_score"
                    name="equifax_score"
                    type="number"
                    min={300}
                    max={850}
                    defaultValue={personal.equifax_score ?? ''}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="transunion_score">TransUnion</Label>
                  <Input
                    id="transunion_score"
                    name="transunion_score"
                    type="number"
                    min={300}
                    max={850}
                    defaultValue={personal.transunion_score ?? ''}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="score_as_of">As of</Label>
                  <Input
                    id="score_as_of"
                    name="score_as_of"
                    type="date"
                    defaultValue={personal.score_as_of ?? ''}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Input
                    id="notes"
                    name="notes"
                    defaultValue={personal.notes}
                  />
                </div>
                <div className="sm:col-span-3">
                  <Button type="submit" size="sm" disabled={pending}>
                    Save scores
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Open items / disputes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {items.length === 0 ? (
                  <p className="text-muted-foreground">None tracked yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {items.map((i) => (
                      <li key={i.id} className="border-b border-border/60 pb-2">
                        <span className="font-medium">{i.title}</span>{' '}
                        <Badge variant="outline">{i.kind}</Badge>{' '}
                        <Badge variant="secondary">{i.status}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
                <form
                  className="grid gap-2"
                  action={(fd) =>
                    start(async () => {
                      const res = await addPersonalCreditItemAction(fd);
                      setMessage(res.ok ? res.message : res.error);
                      router.refresh();
                    })
                  }
                >
                  <input type="hidden" name="profile_id" value={personal.id} />
                  <Input name="title" placeholder="Item title" required />
                  <div className="flex flex-wrap gap-2">
                    <select
                      name="kind"
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      defaultValue="dispute"
                    >
                      {['open_item', 'negative', 'dispute', 'inquiry', 'other'].map(
                        (k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ),
                      )}
                    </select>
                    <select
                      name="bureau"
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      defaultValue=""
                    >
                      <option value="">Bureau</option>
                      {['experian', 'equifax', 'transunion', 'other'].map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" size="sm" disabled={pending}>
                      Add
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Improvement checklist</CardTitle>
                <CardDescription>Next actions (coaching only)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                  {coaching.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
                <ul className="space-y-2">
                  {actions.map((a) => (
                    <li
                      key={a.id}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span>{a.title}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending || a.status === 'done'}
                        onClick={() =>
                          start(async () => {
                            const res = await setPersonalActionStatusAction({
                              actionId: a.id,
                              status: 'done',
                            });
                            setMessage(res.ok ? res.message : res.error);
                            router.refresh();
                          })
                        }
                      >
                        {a.status === 'done' ? 'Done' : 'Mark done'}
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </section>
      ) : null}

      {showBusiness ? (
        <section className="space-y-4">
          <div>
            <h2 className="font-heading text-xl font-semibold text-[#3a414f]">
              Business credit
            </h2>
            <p className="text-sm text-muted-foreground">
              Tage + subsidiaries · DUNS first · monitoring cadence · no fake
              scores. Startup reminder: get DUNS early for app-store companies.
            </p>
          </div>

          {businessError ? (
            <p className="text-sm text-muted-foreground">{businessError}</p>
          ) : null}

          {alerts.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Alerts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {alerts.slice(0, 12).map((a, idx) => (
                  <p key={`${a.entity_id}-${idx}`}>
                    <span className="font-medium">{a.company_name}</span> —{' '}
                    {a.message}
                  </p>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <div className="flex flex-wrap gap-2 text-sm">
            <span className="text-muted-foreground">Company:</span>
            {businessProfiles.map((p) => (
              <button
                key={p.entity_id}
                type="button"
                className={
                  selected === p.entity_id
                    ? 'font-medium underline'
                    : 'text-muted-foreground hover:text-foreground'
                }
                onClick={() => setSelected(p.entity_id)}
              >
                {p.company_name}
              </button>
            ))}
            <Link
              href="/personal/credit"
              className="text-muted-foreground underline-offset-4 hover:underline"
            >
              All
            </Link>
          </div>

          {active ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{active.company_name}</CardTitle>
                <CardDescription>
                  Status{' '}
                  <Badge variant="outline">{active.duns_status}</Badge>
                  {active.duns_number ? ` · DUNS ${active.duns_number}` : ''}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="grid gap-3 sm:grid-cols-2"
                  action={(fd) =>
                    start(async () => {
                      const res = await upsertBusinessCreditAction(fd);
                      setMessage(res.ok ? res.message : res.error);
                      router.refresh();
                    })
                  }
                >
                  <input type="hidden" name="entity_id" value={active.entity_id} />
                  <div className="space-y-1.5">
                    <Label htmlFor="duns_number">DUNS</Label>
                    <Input
                      id="duns_number"
                      name="duns_number"
                      defaultValue={active.duns_number ?? ''}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="duns_status">DUNS status</Label>
                    <select
                      id="duns_status"
                      name="duns_status"
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      defaultValue={active.duns_status}
                    >
                      {[
                        'unknown',
                        'not_started',
                        'pending',
                        'active',
                        'stale',
                        'issue',
                      ].map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="dn_b_score">D&B score (manual)</Label>
                    <Input
                      id="dn_b_score"
                      name="dn_b_score"
                      defaultValue={active.dn_b_score ?? ''}
                      placeholder="Leave blank — no fake scores"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="monitoring_cadence">Cadence</Label>
                    <select
                      id="monitoring_cadence"
                      name="monitoring_cadence"
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      defaultValue={active.monitoring_cadence}
                    >
                      {['monthly', 'quarterly', 'annual'].map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="next_review_at">Next review</Label>
                    <Input
                      id="next_review_at"
                      name="next_review_at"
                      type="date"
                      defaultValue={active.next_review_at ?? ''}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="report_as_of">Report as of</Label>
                    <Input
                      id="report_as_of"
                      name="report_as_of"
                      type="date"
                      defaultValue={active.report_as_of ?? ''}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="negative_notes">Negative notes</Label>
                    <Input
                      id="negative_notes"
                      name="negative_notes"
                      defaultValue={active.negative_notes}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Button type="submit" size="sm" disabled={pending}>
                      Save business credit
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-muted-foreground">
              No business credit profiles yet — apply Phase 73 SQL to seed
              company shells.
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
