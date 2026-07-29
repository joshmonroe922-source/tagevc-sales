'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import {
  createHireScenarioAction,
  updateHireTemplateAction,
} from '@/app/(app)/admin/hire-impact/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  buildMonthlyImpact,
  formatUsd,
  fullyLoadedAnnual,
  type HireImpactScenario,
  type HireRoleCostTemplate,
} from '@/lib/hire/impact';
import { entityDisplayName } from '@/lib/entities/display-name';

export function HireImpactClient({
  templates,
  scenarios,
  entityId,
  canEdit,
  tableReady,
}: {
  templates: HireRoleCostTemplate[];
  scenarios: HireImpactScenario[];
  entityId: string;
  canEdit: boolean;
  tableReady: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const selected = templates.find((t) => t.id === templateId) ?? templates[0];

  const preview = useMemo(() => {
    if (!selected) return null;
    return buildMonthlyImpact({
      start_month: new Date().toISOString().slice(0, 7),
      months: 12,
      base_salary_annual: selected.base_salary_annual,
      burden_pct: selected.burden_pct,
      tools_annual: selected.tools_annual,
      recruiting_one_time: selected.recruiting_one_time,
      headcount: 1,
    });
  }, [selected]);

  const entityScoped = templates.filter((t) => t.entity_id === entityId);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
          Leadership · Hire financial impact
        </p>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-[#3a414f]">
          {entityDisplayName(entityId)} workforce cost
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Role-specific fully loaded cost and monthly budget impact. Assumptions
          stay editable until IES payroll is live. Tie scenarios to hire /
          Reports-to.
        </p>
        {!tableReady ? (
          <p className="text-xs text-amber-700">
            Apply phase85 SQL for hire cost tables.
          </p>
        ) : null}
      </header>

      <div className="flex flex-wrap gap-2">
        {['ENT-FIRM', 'ENT-R619', 'ENT-SIGNENT', 'ENT-INDA'].map((id) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={id === entityId ? 'default' : 'outline'}
            className={
              id === entityId
                ? 'bg-[#3a414f] text-white hover:bg-[#535c63]'
                : undefined
            }
            onClick={() =>
              router.push(`/admin/hire-impact?entity=${id}`)
            }
          >
            {entityDisplayName(id)}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Role cost templates</CardTitle>
            <CardDescription>
              Fully loaded = salary + burden + tools (+ recruiting in month 1).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <select
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              value={selected?.id ?? ''}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              {(entityScoped.length ? entityScoped : templates).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} · {formatUsd(t.base_salary_annual)} base
                </option>
              ))}
            </select>
            {selected ? (
              <>
                <p className="text-sm">
                  Fully loaded / yr:{' '}
                  <strong>
                    {formatUsd(
                      fullyLoadedAnnual({
                        base_salary_annual: selected.base_salary_annual,
                        burden_pct: selected.burden_pct,
                        tools_annual: selected.tools_annual,
                      }),
                    )}
                  </strong>
                  <span className="text-muted-foreground">
                    {' '}
                    (burden {(selected.burden_pct * 100).toFixed(0)}%)
                  </span>
                </p>
                {canEdit ? (
                  <form
                    className="grid gap-2 sm:grid-cols-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      start(async () => {
                        const res = await updateHireTemplateAction(fd);
                        setMessage(res.ok ? 'Template saved' : res.error);
                        router.refresh();
                      });
                    }}
                  >
                    <input type="hidden" name="entity_id" value={selected.entity_id} />
                    <input type="hidden" name="role_key" value={selected.role_key} />
                    <input type="hidden" name="title" value={selected.title} />
                    <div className="space-y-1">
                      <Label className="text-xs">Base salary</Label>
                      <Input
                        name="base_salary_annual"
                        type="number"
                        defaultValue={selected.base_salary_annual}
                        className="h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Burden %</Label>
                      <Input
                        name="burden_pct"
                        type="number"
                        step="0.01"
                        defaultValue={selected.burden_pct}
                        className="h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Tools / yr</Label>
                      <Input
                        name="tools_annual"
                        type="number"
                        defaultValue={selected.tools_annual}
                        className="h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Recruiting one-time</Label>
                      <Input
                        name="recruiting_one_time"
                        type="number"
                        defaultValue={selected.recruiting_one_time}
                        className="h-8"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Button type="submit" size="sm" disabled={pending}>
                        Save assumptions
                      </Button>
                    </div>
                  </form>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No templates yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">12-month budget curve</CardTitle>
            <CardDescription>
              Dynamic monthly impact for the selected role.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {preview ? (
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="py-1 pr-2">Month</th>
                      <th className="py-1 pr-2">Total</th>
                      <th className="py-1">Cumulative</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((m) => (
                      <tr key={m.monthKey} className="border-b border-border/60">
                        <td className="py-1 pr-2">{m.monthKey}</td>
                        <td className="py-1 pr-2">{formatUsd(m.total)}</td>
                        <td className="py-1">{formatUsd(m.cumulative)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Select a role.</p>
            )}
            {canEdit && selected ? (
              <Button
                className="mt-3"
                size="sm"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await createHireScenarioAction({
                      entityId,
                      templateId: selected.id,
                      roleTitle: selected.title,
                      baseSalary: selected.base_salary_annual,
                      burdenPct: selected.burden_pct,
                      toolsAnnual: selected.tools_annual,
                      recruiting: selected.recruiting_one_time,
                    });
                    setMessage(res.ok ? 'Scenario added' : res.error);
                    router.refresh();
                  })
                }
              >
                Add planned hire scenario
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active scenarios</CardTitle>
          <CardDescription>
            Tied to hire flow — {scenarios.length} open
            {searchParams.get('from') === 'hire' ? ' · opened from hire' : ''}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {scenarios.length === 0 ? (
            <p className="text-sm text-muted-foreground">No scenarios yet.</p>
          ) : (
            scenarios.map((s) => {
              const annual = fullyLoadedAnnual(s);
              return (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">{s.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.role_title} · start {s.start_month.slice(0, 7)} ·{' '}
                      {s.status}
                    </p>
                  </div>
                  <p className="text-sm font-semibold">{formatUsd(annual)}/yr</p>
                </div>
              );
            })
          )}
          <p className="pt-2 text-xs text-muted-foreground">
            <Link href="/shared-services/hr" className="underline">
              Open HR hire / onboarding
            </Link>{' '}
            — Reports to is required; create a scenario when planning headcount.
          </p>
        </CardContent>
      </Card>

      {message ? (
        <p className="text-xs text-muted-foreground">{message}</p>
      ) : null}
    </div>
  );
}
