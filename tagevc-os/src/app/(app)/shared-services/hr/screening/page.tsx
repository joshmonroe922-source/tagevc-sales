import Link from 'next/link';

import {
  confirmScreeningOrderAction,
  createPendingScreeningOrderAction,
  waiveScreeningOrderAction,
} from '@/app/(app)/screening/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { listPartnerBindings } from '@/lib/partners/repo';
import { partnerConnectionStatus } from '@/lib/partners/env';
import { listScreeningOrders, listScreeningPackages } from '@/lib/screening/repo';
import {
  canManageScreening,
  isVerifiedFirstLive,
} from '@/lib/screening/types';
import { verifiedFirstApiConfigured } from '@/lib/screening/vendor';
import { entityDisplayName } from '@/lib/entities/display-name';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';

type Props = {
  searchParams?: Promise<{ entity?: string; order?: string }>;
};

export default async function ScreeningAdminPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const params = (await searchParams) ?? {};
  const entityId = params.entity?.trim() || undefined;
  const highlight = params.order?.trim() || '';

  const ctx = await getSessionContext();
  const canManage = canManageScreening(ctx?.profile.role);
  const live = isVerifiedFirstLive();
  const apiConfigured = verifiedFirstApiConfigured();
  const webhookConfigured = Boolean(
    process.env.VERIFIED_FIRST_WEBHOOK_SECRET?.trim(),
  );
  const partnerStatus = partnerConnectionStatus('verified_first');

  const [{ packages }, { orders, error }, allBindings] = await Promise.all([
    listScreeningPackages({ activeOnly: false }),
    listScreeningOrders({ entityId, limit: 80 }),
    listPartnerBindings(),
  ]);

  const vfBindings = allBindings.filter((b) => b.partner_key === 'verified_first');
  const packagesMissingVendorId = packages.filter(
    (p) => p.active && !String(p.vendor_package_id ?? '').trim(),
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            <Link href="/shared-services/hr" className="hover:underline">
              HR
            </Link>
            {' · '}
            Verified First spine
          </p>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Screening
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Packages + order queue. Human confirm required. LIVE=
            {live ? '1' : '0'} fail-closed.
          </p>
        </div>
        <Badge variant={live ? 'default' : 'secondary'}>
          VERIFIED_FIRST_LIVE={live ? '1' : '0'}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connection status</CardTitle>
          <CardDescription>
            Partner spine · status <code>{partnerStatus}</code>. Secrets live in
            Vercel env — never in binding config. Docs:{' '}
            <Link
              href="/shared-services/it/technology-stack"
              className="underline underline-offset-2"
            >
              Technology stack
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ul className="space-y-1.5">
            <li className="flex flex-wrap items-center gap-2">
              <Badge variant={apiConfigured ? 'outline' : 'secondary'}>
                Basic Auth {apiConfigured ? 'set' : 'missing'}
              </Badge>
              <Badge variant={webhookConfigured ? 'outline' : 'secondary'}>
                Webhook secret {webhookConfigured ? 'set' : 'missing'}
              </Badge>
              <Badge variant={live ? 'default' : 'secondary'}>
                LIVE={live ? '1' : '0'}
              </Badge>
            </li>
          </ul>
          {!apiConfigured ? (
            <p className="text-muted-foreground">
              Set <code>VERIFIED_FIRST_API_USERNAME</code> +{' '}
              <code>VERIFIED_FIRST_API_PASSWORD</code> (+ webhook secret) in
              Vercel after VF Integrations provisions Staging credentials. Flip{' '}
              <code>VERIFIED_FIRST_LIVE=1</code> only after a smoke order. Not
              blocked by CRM rebuild / SF migration.
            </p>
          ) : !live ? (
            <p className="text-muted-foreground">
              Basic Auth present — still fail-closed until{' '}
              <code>VERIFIED_FIRST_LIVE=1</code>. Local confirm still records
              orders without calling the vendor.
            </p>
          ) : null}
          {packagesMissingVendorId > 0 ? (
            <p className="text-amber-800 dark:text-amber-200">
              {packagesMissingVendorId} active package
              {packagesMissingVendorId === 1 ? '' : 's'} missing{' '}
              <code>vendor_package_id</code> — map VF package IDs before live
              orders.
            </p>
          ) : null}
          {vfBindings.length > 0 ? (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Entity bindings
              </p>
              <ul className="space-y-1">
                {vfBindings.map((b) => (
                  <li
                    key={b.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-1"
                  >
                    <span>
                      {entityDisplayName(b.entity_id)}
                      <span className="text-muted-foreground">
                        {' '}
                        · {b.enabled ? 'enabled' : 'disabled'} · {b.status}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {b.external_account_id
                        ? `acct ${b.external_account_id}`
                        : 'no VF account # yet'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-muted-foreground">
              No partner bindings — apply phase89 SQL / provision spine.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Packages</CardTitle>
          <CardDescription>
            Vendor catalog (`os_screening_packages`) — Visionary/HR manage
          </CardDescription>
        </CardHeader>
        <CardContent>
          {packages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No packages — apply phase80 SQL.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {packages.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2"
                >
                  <span>
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted-foreground">
                      {' '}
                      · {p.code} · {p.kind}
                      {p.vendor_package_id
                        ? ` · vf:${p.vendor_package_id}`
                        : ' · vf id unset'}
                    </span>
                  </span>
                  <Badge variant={p.active ? 'outline' : 'secondary'}>
                    {p.active ? 'active' : 'inactive'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create pending order</CardTitle>
            <CardDescription>
              Creates a ready-to-order row — does not call the vendor until
              confirm.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createPendingScreeningOrderAction} className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Entity ID
                <input
                  name="entity_id"
                  required
                  defaultValue={entityId ?? 'ENT-001'}
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-sm">
                Subject type
                <select
                  name="subject_type"
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  defaultValue="employee"
                >
                  <option value="employee">employee</option>
                  <option value="placement">placement</option>
                  <option value="candidate">candidate</option>
                  <option value="signent_client_employee">
                    signent_client_employee
                  </option>
                </select>
              </label>
              <label className="text-sm">
                Subject ID
                <input
                  name="subject_id"
                  required
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-sm">
                Kind
                <select
                  name="kind"
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  defaultValue="bg"
                >
                  <option value="bg">bg</option>
                  <option value="drug">drug</option>
                  <option value="combo">combo</option>
                </select>
              </label>
              <label className="text-sm sm:col-span-2">
                Package
                <select
                  name="package_id"
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  defaultValue={packages[0]?.id ?? ''}
                >
                  {packages
                    .filter((p) => p.active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.code})
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-sm">
                Subject name
                <input
                  name="subject_name"
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-sm">
                Subject email
                <input
                  name="subject_email"
                  type="email"
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
              </label>
              <div className="sm:col-span-2">
                <Button type="submit" size="sm">
                  Create pending order
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Order queue</CardTitle>
          <CardDescription>
            {error ? `Load error: ${error}` : `${orders.length} recent orders`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No orders yet.</p>
          ) : (
            orders.map((o) => (
              <div
                key={o.id}
                className={`rounded-md border px-3 py-3 text-sm ${
                  highlight === o.id
                    ? 'border-foreground/40 bg-muted/40'
                    : 'border-border'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {o.package_code || o.kind} · {o.subject_type}/
                      {o.subject_id}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {entityDisplayName(o.entity_id)} · {o.id.slice(0, 8)}…
                      {o.external_order_id
                        ? ` · ext ${o.external_order_id}`
                        : ''}
                      {o.raw_status ? ` · raw ${o.raw_status}` : ''}
                    </p>
                  </div>
                  <Badge variant="outline">{o.status}</Badge>
                </div>
                {canManage &&
                ['pending', 'ordered', 'in_progress', 'review'].includes(
                  o.status,
                ) ? (
                  <div className="mt-3 flex flex-wrap gap-3">
                    <form
                      action={confirmScreeningOrderAction}
                      className="flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="order_id" value={o.id} />
                      <input
                        type="hidden"
                        name="subject_name"
                        value={String(o.consumer_ref.subject_name ?? '')}
                      />
                      <input
                        type="hidden"
                        name="subject_email"
                        value={String(o.consumer_ref.subject_email ?? '')}
                      />
                      <label className="flex items-center gap-1.5 text-xs">
                        <input type="checkbox" name="human_confirm" value="1" required />
                        I confirm placing this Verified First order
                      </label>
                      <Button type="submit" size="sm">
                        Confirm &amp; order
                      </Button>
                    </form>
                    <form
                      action={waiveScreeningOrderAction}
                      className="flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="order_id" value={o.id} />
                      <input
                        name="waiver_reason"
                        required
                        placeholder="Waiver reason (audited)"
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                      />
                      <Button type="submit" size="sm" variant="outline">
                        Waive
                      </Button>
                    </form>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
