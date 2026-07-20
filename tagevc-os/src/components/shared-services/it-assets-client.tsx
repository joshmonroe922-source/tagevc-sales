'use client';

import { useActionState, useState, useTransition } from 'react';
import {
  assignHardwareAction,
  completeOffboardingAction,
  createHardwareAction,
  createLicenseAction,
  executeOffboardingAction,
  grantSeatAction,
  returnHardwareAction,
  revokeSeatAction,
  startOffboardingAction,
  startOffboardingFromTicketAction,
  scanInactiveOffboardingAction,
  startOnboardingAction,
  executeOnboardingAction,
  completeOnboardingAction,
  startOnboardingFromTicketAction,
  scanActiveOnboardingAction,
  scanLicenseRenewalsAction,
  type ItAssetActionResult,
} from '@/app/(app)/shared-services/it/assets/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { OffboardingRun } from '@/lib/shared-services/it-offboarding';
import type { OnboardingRun } from '@/lib/shared-services/it-onboarding';
import { upcomingLicenseRenewals } from '@/lib/shared-services/it-license-renewals';
import type {
  ItAssignmentEvent,
  ItHardwareAsset,
  ItSoftwareLicense,
} from '@/lib/shared-services/it-assets-types';

function ActionMessage({ state }: { state: ItAssetActionResult | null }) {
  if (!state) return null;
  if (state.ok) {
    return (
      <p className="text-sm text-emerald-700">{state.message ?? 'Done'}</p>
    );
  }
  return <p className="text-sm text-destructive">{state.error}</p>;
}

export function ItAssetsClient({
  hardware,
  licenses,
  events,
  offboarding,
  onboarding = [],
  candidateTickets,
  onboardingTickets = [],
  canWrite,
  tableError,
}: {
  hardware: ItHardwareAsset[];
  licenses: ItSoftwareLicense[];
  events: ItAssignmentEvent[];
  offboarding: OffboardingRun[];
  onboarding?: OnboardingRun[];
  candidateTickets: Array<{
    ticket_id: string;
    title: string;
    service: string;
    status: string;
  }>;
  onboardingTickets?: Array<{
    ticket_id: string;
    title: string;
    service: string;
    status: string;
  }>;
  canWrite: boolean;
  tableError?: string;
}) {
  const [hwState, hwAction, hwPending] = useActionState(
    createHardwareAction,
    null as ItAssetActionResult | null,
  );
  const [licState, licAction, licPending] = useActionState(
    createLicenseAction,
    null as ItAssetActionResult | null,
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(
    fn: () => Promise<ItAssetActionResult>,
  ) {
    setMsg(null);
    setErr(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) setMsg(res.message ?? 'Done');
      else setErr(res.error);
    });
  }

  const renewals = upcomingLicenseRenewals(licenses, 30);

  return (
    <div className="space-y-8">
      {tableError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Tables unavailable — apply phase20–26 IT SQL. {tableError}
        </p>
      )}
      {renewals.length > 0 && (
        <div className="rounded-md border border-amber-600/40 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p className="font-medium">
            {renewals.length} license renewal(s) within 30 days
          </p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {renewals.slice(0, 5).map((l) => (
              <li key={l.license_id}>
                {l.product_name} · {l.renewal_date?.slice(0, 10)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(msg || err) && (
        <p className={`text-sm ${err ? 'text-destructive' : 'text-emerald-700'}`}>
          {err ?? msg}
        </p>
      )}

      {canWrite && (
        <div className="grid gap-6 lg:grid-cols-2">
          <form action={hwAction} className="space-y-3 rounded-lg border p-4">
            <h2 className="text-sm font-semibold">Add hardware</h2>
            <div className="space-y-1">
              <Label htmlFor="kind">Kind</Label>
              <select
                id="kind"
                name="kind"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue="laptop"
              >
                <option value="laptop">Laptop</option>
                <option value="phone">Phone</option>
                <option value="peripheral">Peripheral</option>
                <option value="other_hardware">Other</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="model">Model</Label>
              <Input id="model" name="model" placeholder="MacBook Pro 14" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="serial_number">Serial</Label>
              <Input id="serial_number" name="serial_number" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="entity_id">Entity id (optional)</Label>
              <Input id="entity_id" name="entity_id" placeholder="ENT-001" />
            </div>
            <Button type="submit" size="sm" disabled={hwPending}>
              Create asset
            </Button>
            <ActionMessage state={hwState} />
          </form>

          <form action={licAction} className="space-y-3 rounded-lg border p-4">
            <h2 className="text-sm font-semibold">Add software license</h2>
            <div className="space-y-1">
              <Label htmlFor="product_name">Product</Label>
              <Input
                id="product_name"
                name="product_name"
                required
                placeholder="Microsoft 365"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vendor">Vendor</Label>
              <Input id="vendor" name="vendor" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="seat_count">Seats</Label>
              <Input
                id="seat_count"
                name="seat_count"
                type="number"
                min={1}
                defaultValue={5}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lic_entity">Entity id (optional)</Label>
              <Input id="lic_entity" name="entity_id" placeholder="ENT-001" />
            </div>
            <Button type="submit" size="sm" disabled={licPending}>
              Create license
            </Button>
            <ActionMessage state={licState} />
          </form>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Hardware</h2>
        {hardware.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hardware assets yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-2">Asset</th>
                  <th className="py-2 pr-2">Kind</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Model</th>
                  <th className="py-2 pr-2">Assigned</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {hardware.map((a) => (
                  <tr key={a.asset_id} className="border-b border-border/40">
                    <td className="py-2 pr-2 font-mono text-xs">{a.asset_id}</td>
                    <td className="py-2 pr-2">{a.kind}</td>
                    <td className="py-2 pr-2">{a.status}</td>
                    <td className="py-2 pr-2">{a.model ?? '—'}</td>
                    <td className="py-2 pr-2 font-mono text-xs">
                      {a.assigned_user_id?.slice(0, 8) ?? '—'}
                    </td>
                    <td className="py-2">
                      {canWrite && (
                        <div className="flex flex-wrap gap-1">
                          {a.status !== 'assigned' && a.status !== 'retired' && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() => {
                                const userId = window.prompt(
                                  'Assign to user UUID:',
                                );
                                if (!userId) return;
                                run(() =>
                                  assignHardwareAction(a.asset_id, userId),
                                );
                              }}
                            >
                              Assign
                            </Button>
                          )}
                          {a.status === 'assigned' && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() =>
                                run(() => returnHardwareAction(a.asset_id))
                              }
                            >
                              Return
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Software licenses</h2>
        {canWrite && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => scanLicenseRenewalsAction())}
          >
            Scan renewals (30d)
          </Button>
        )}
        {licenses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No licenses yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-2">License</th>
                  <th className="py-2 pr-2">Product</th>
                  <th className="py-2 pr-2">Seats</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {licenses.map((l) => (
                  <tr key={l.license_id} className="border-b border-border/40">
                    <td className="py-2 pr-2 font-mono text-xs">
                      {l.license_id}
                    </td>
                    <td className="py-2 pr-2">
                      {l.product_name}
                      {l.vendor ? (
                        <span className="text-muted-foreground">
                          {' '}
                          · {l.vendor}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2">
                      {l.seats_used ?? 0}
                      {l.seat_count != null ? ` / ${l.seat_count}` : ''}
                    </td>
                    <td className="py-2 pr-2">{l.status}</td>
                    <td className="py-2">
                      {canWrite && l.status === 'active' && (
                        <div className="flex flex-wrap gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() =>
                              run(() => grantSeatAction(l.license_id))
                            }
                          >
                            Grant seat
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() =>
                              run(() => revokeSeatAction(l.license_id))
                            }
                          >
                            Revoke
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>


      <section className="space-y-3">
        <h2 className="text-base font-semibold">Onboarding</h2>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                const userId = window.prompt('User UUID to onboard:');
                if (!userId) return;
                const auto = window.confirm(
                  'Auto-assign stock hardware + grant seats now?',
                );
                run(() =>
                  startOnboardingAction(userId.trim(), undefined, auto),
                );
              }}
            >
              Start onboarding
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => scanActiveOnboardingAction())}
            >
              Scan active profiles
            </Button>
          </div>
        )}
        {onboardingTickets.length > 0 && (
          <div className="space-y-2 rounded-md border border-border/60 p-3">
            <p className="text-xs font-medium text-muted-foreground">
              HR/IT tickets that look like onboarding (include{' '}
              <code className="text-xs">user:&lt;uuid&gt;</code> in description)
            </p>
            <ul className="space-y-1 text-sm">
              {onboardingTickets.map((t) => (
                <li
                  key={t.ticket_id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 py-1.5"
                >
                  <span>
                    <a
                      href={`/shared-services/tickets/${t.ticket_id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {t.ticket_id}
                    </a>
                    {' · '}
                    {t.title}
                  </span>
                  {canWrite && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          startOnboardingFromTicketAction(t.ticket_id, true),
                        )
                      }
                    >
                      Start from ticket
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {onboarding.length === 0 ? (
          <p className="text-sm text-muted-foreground">No onboarding runs yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {onboarding.map((r) => (
              <li key={r.run_id} className="rounded-md border border-border/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-mono text-xs">{r.run_id}</span>
                    {' · '}
                    {r.status}
                    {' · '}
                    {r.source}
                    {r.ticket_id ? ` · ${r.ticket_id}` : ''}
                    {' · user '}
                    {r.user_id.slice(0, 8)}…
                  </span>
                  {canWrite && r.status !== 'completed' && (
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          run(() => executeOnboardingAction(r.run_id))
                        }
                      >
                        Execute
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          run(() => completeOnboardingAction(r.run_id))
                        }
                      >
                        Mark complete
                      </Button>
                    </div>
                  )}
                </div>
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {r.checklist.map((c) => (
                    <li key={c.id}>
                      {c.status === 'done' ? '✓' : c.status === 'failed' ? '✗' : '○'}{' '}
                      {c.label}
                      {c.detail ? ` · ${c.detail}` : ''}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Offboarding</h2>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                const userId = window.prompt('User UUID to offboard:');
                if (!userId) return;
                const auto = window.confirm(
                  'Auto-execute hardware return + license revoke now?',
                );
                run(() =>
                  startOffboardingAction(userId.trim(), undefined, auto),
                );
              }}
            >
              Start offboarding
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => scanInactiveOffboardingAction())}
            >
              Scan inactive profiles
            </Button>
          </div>
        )}
        {candidateTickets.length > 0 && (
          <div className="space-y-2 rounded-md border border-border/60 p-3">
            <p className="text-xs font-medium text-muted-foreground">
              HR/IT tickets that look like offboarding (include{' '}
              <code className="text-xs">user:&lt;uuid&gt;</code> in description)
            </p>
            <ul className="space-y-1 text-sm">
              {candidateTickets.map((t) => (
                <li
                  key={t.ticket_id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 py-1.5"
                >
                  <span>
                    <a
                      href={`/shared-services/tickets/${t.ticket_id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {t.ticket_id}
                    </a>
                    {' · '}
                    {t.title}
                    <span className="text-xs text-muted-foreground">
                      {' '}
                      · {t.service}
                    </span>
                  </span>
                  {canWrite && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          startOffboardingFromTicketAction(t.ticket_id, true),
                        )
                      }
                    >
                      Start from ticket
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {offboarding.length === 0 ? (
          <p className="text-sm text-muted-foreground">No offboarding runs yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {offboarding.map((r) => (
              <li key={r.run_id} className="rounded-md border border-border/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-mono text-xs">{r.run_id}</span>
                    {' · '}
                    {r.status}
                    {' · '}
                    {r.source}
                    {r.ticket_id ? ` · ${r.ticket_id}` : ''}
                    {' · user '}
                    {r.user_id.slice(0, 8)}…
                  </span>
                  {canWrite && r.status !== 'completed' && (
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          run(() => executeOffboardingAction(r.run_id))
                        }
                      >
                        Execute
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          run(() => completeOffboardingAction(r.run_id))
                        }
                      >
                        Mark complete
                      </Button>
                    </div>
                  )}
                </div>
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {r.checklist.map((c) => (
                    <li key={c.id}>
                      {c.status === 'done' ? '✓' : c.status === 'failed' ? '✗' : '○'}{' '}
                      {c.label}
                      {c.detail ? ` · ${c.detail}` : ''}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Assignment history</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {events.map((e) => (
              <li
                key={e.event_id}
                className="border-b border-border/40 py-1.5 text-muted-foreground"
              >
                <span className="font-medium text-foreground">{e.kind}</span>
                {' · '}
                {e.asset_id || e.license_id || '—'}
                {e.user_id ? ` · user ${e.user_id.slice(0, 8)}…` : ''}
                {' · '}
                <span className="text-xs">
                  {e.created_at.slice(0, 19).replace('T', ' ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
