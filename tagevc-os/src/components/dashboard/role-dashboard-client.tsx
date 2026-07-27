'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ViewModeToggle,
  useViewMode,
} from '@/components/ui/view-mode-toggle';
import {
  DASHBOARD_VIEW_ROLES,
  dashboardRoleLabel,
  type DashboardScopeMode,
  type RoleDashboardCard,
} from '@/lib/dashboard/role-dashboard-catalog';
import { sortEntitiesForSelect } from '@/lib/entities/display-order';
import type { AppRole } from '@/lib/types/roles';
import { cn } from '@/lib/utils';
import { VIEW_MODE_DEFAULTS } from '@/lib/view-mode';

type CompanyOption = { entity_id: string; name: string };

type Props = {
  role: AppRole;
  viewAsRole: AppRole;
  canSwitchRoles: boolean;
  scope: DashboardScopeMode;
  selectedEntityId: string | null;
  companies: CompanyOption[];
  /** When false, Consolidated is hidden (COO / Subsidiary Leader). */
  canViewConsolidated?: boolean;
  cards: RoleDashboardCard[];
};

function CardStatusBadge({ card }: { card: RoleDashboardCard }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'shrink-0 font-normal capitalize',
        card.data_state === 'live' && 'border-emerald-300 text-emerald-800',
        card.data_state === 'partial' && 'border-amber-300 text-amber-900',
      )}
    >
      {card.data_state === 'not_connected' ? 'Not connected' : card.data_state}
    </Badge>
  );
}

function cardMetaLine(card: RoleDashboardCard): string {
  const parts = [
    card.variance_label,
    card.on_track === true
      ? 'On track'
      : card.on_track === false
        ? 'Off track'
        : null,
    card.company_name ?? null,
  ].filter(Boolean);
  return parts.join(' · ');
}

function trackLabel(card: RoleDashboardCard): string {
  if (card.on_track === true) return 'On track';
  if (card.on_track === false) return 'Off track';
  return '—';
}

export function RoleDashboardClient({
  role,
  viewAsRole,
  canSwitchRoles,
  scope,
  selectedEntityId,
  companies,
  canViewConsolidated = true,
  cards,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useViewMode(
    'role-dashboard',
    VIEW_MODE_DEFAULTS['role-dashboard'],
  );

  function setParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') next.delete(k);
      else next.set(k, v);
    }
    startTransition(() => {
      router.replace(`/dashboard?${next.toString()}`);
    });
  }

  const companyOptions = sortEntitiesForSelect(
    companies.map((c) => ({
      entity_id: c.entity_id,
      name: c.name,
    })),
  ).map((c) => ({
    entity_id: String(c.entity_id),
    name: String(c.name ?? c.entity_id),
  }));

  const selectValue =
    scope === 'company' && selectedEntityId
      ? selectedEntityId
      : canViewConsolidated
        ? 'consolidated'
        : (selectedEntityId ?? companyOptions[0]?.entity_id ?? '');

  const cardsView = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <Card key={`${card.kpi_id}-${card.company_id ?? 'all'}`}>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-sm">{card.label}</CardTitle>
              <CardStatusBadge card={card} />
            </div>
            <CardDescription>{card.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">Actual · </span>
              {card.actual ?? '—'}
            </p>
            <p>
              <span className="text-muted-foreground">Goal · </span>
              {card.goal ?? 'Goal not set'}
            </p>
            <p className="text-xs text-muted-foreground">{cardMetaLine(card)}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );

  const listView = (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">KPI</th>
            <th className="px-4 py-2.5 font-medium text-right">Actual</th>
            <th className="px-4 py-2.5 font-medium text-right">Goal</th>
            <th className="hidden px-4 py-2.5 font-medium md:table-cell">
              Track
            </th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="hidden px-4 py-2.5 font-medium lg:table-cell">
              Company
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {cards.map((card) => (
            <tr
              key={`${card.kpi_id}-${card.company_id ?? 'all'}`}
              className="hover:bg-muted/30"
            >
              <td className="px-4 py-2.5">
                <p className="font-medium text-[#3a414f]">{card.label}</p>
                <p className="text-xs text-muted-foreground line-clamp-1">
                  {card.description}
                </p>
                {card.variance_label ? (
                  <p className="text-xs text-muted-foreground">
                    {card.variance_label}
                  </p>
                ) : null}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                {card.actual ?? '—'}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                {card.goal ?? '—'}
              </td>
              <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">
                {trackLabel(card)}
              </td>
              <td className="px-4 py-2.5">
                <CardStatusBadge card={card} />
              </td>
              <td className="hidden px-4 py-2.5 text-muted-foreground lg:table-cell">
                {card.company_name ?? 'Consolidated'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-heading text-lg text-foreground">
            {dashboardRoleLabel(viewAsRole)} dashboard
          </h2>
          <p className="text-sm text-muted-foreground">
            Goals vs actuals for this role. Cards stay visible when data is not
            yet connected — numbers are never invented.
            {canSwitchRoles && viewAsRole !== role
              ? ' Dashboard view only — sensitive actions still follow Visionary safety rules.'
              : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canSwitchRoles ? (
            <label className="text-xs text-muted-foreground">
              View as
              <select
                className="ml-2 h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
                value={viewAsRole}
                disabled={pending}
                onChange={(e) => setParams({ as: e.target.value })}
              >
                {DASHBOARD_VIEW_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {dashboardRoleLabel(r)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="text-xs text-muted-foreground">
            P&amp;L / company
            <select
              aria-label="P&L and company scope"
              className="ml-2 h-9 min-w-[12rem] rounded-md border border-border bg-background px-2 text-sm text-foreground"
              value={selectValue}
              disabled={pending}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'consolidated') {
                  setParams({ scope: 'consolidated', entity: null });
                } else {
                  setParams({ scope: 'company', entity: v });
                }
              }}
            >
              {canViewConsolidated ? (
                <option value="consolidated">Consolidated</option>
              ) : null}
              {companyOptions.map((c) => (
                <option key={c.entity_id} value={c.entity_id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              View
            </span>
            <ViewModeToggle
              mode={mode}
              onChange={setMode}
              id="view-mode-role-dashboard"
            />
          </div>
        </div>
      </div>

      {mode === 'cards' ? cardsView : listView}
    </div>
  );
}
