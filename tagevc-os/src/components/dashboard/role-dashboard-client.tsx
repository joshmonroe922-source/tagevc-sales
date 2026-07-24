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
import { Button } from '@/components/ui/button';
import {
  DASHBOARD_VIEW_ROLES,
  dashboardRoleLabel,
  type DashboardScopeMode,
  type RoleDashboardCard,
} from '@/lib/dashboard/role-dashboard-catalog';
import type { AppRole } from '@/lib/types/roles';
import { cn } from '@/lib/utils';

type Props = {
  role: AppRole;
  viewAsRole: AppRole;
  canSwitchRoles: boolean;
  scope: DashboardScopeMode;
  cards: RoleDashboardCard[];
};

export function RoleDashboardClient({
  role,
  viewAsRole,
  canSwitchRoles,
  scope,
  cards,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    startTransition(() => {
      router.replace(`/dashboard?${next.toString()}`);
    });
  }

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
                onChange={(e) => setParam('as', e.target.value)}
              >
                {DASHBOARD_VIEW_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {dashboardRoleLabel(r)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="inline-flex rounded-md border border-border p-0.5">
            {(['consolidated', 'by_company'] as const).map((mode) => (
              <Button
                key={mode}
                type="button"
                size="sm"
                variant={scope === mode ? 'default' : 'ghost'}
                className="h-8 text-xs"
                disabled={pending}
                onClick={() => setParam('scope', mode)}
              >
                {mode === 'consolidated' ? 'Consolidated' : 'By company'}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Card key={`${card.kpi_id}-${card.company_id ?? 'all'}`}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-sm">{card.label}</CardTitle>
                <Badge
                  variant="outline"
                  className={cn(
                    'shrink-0 font-normal capitalize',
                    card.data_state === 'live' && 'border-emerald-300 text-emerald-800',
                    card.data_state === 'partial' && 'border-amber-300 text-amber-900',
                  )}
                >
                  {card.data_state === 'not_connected'
                    ? 'Not connected'
                    : card.data_state}
                </Badge>
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
              <p className="text-xs text-muted-foreground">
                {card.variance_label}
                {card.on_track === true
                  ? ' · On track'
                  : card.on_track === false
                    ? ' · Off track'
                    : ''}
                {card.company_name ? ` · ${card.company_name}` : ''}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
