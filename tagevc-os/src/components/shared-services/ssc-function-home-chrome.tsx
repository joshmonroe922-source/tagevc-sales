'use client';

import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { CompanySelect } from '@/components/shared/company-select';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CONSOLIDATED_SELECT_VALUE,
  entitySelectLabel,
} from '@/lib/entities/display-order';
import { getCachedEntitySelectOptions } from '@/lib/entities/entity-select-cache';
import {
  functionLabel,
  type SscFunction,
} from '@/lib/shared-services/ssc-checklist/types';
import { SscFunctionCapabilities } from '@/components/shared-services/ssc-function-capabilities';
import type { SscFunctionHomeGlance } from '@/lib/shared-services/ssc-checklist/function-home-glance';
import {
  timeNavLabel,
  type SscAttentionKind,
  type SscTimeNav,
} from '@/lib/shared-services/ssc-checklist/period';
import { cn } from '@/lib/utils';

function attentionBadgeLabel(kind: SscAttentionKind | null): string {
  switch (kind) {
    case 'overdue':
      return 'Overdue';
    case 'due_today':
      return 'Due today';
    case 'due_soon':
      return 'Due soon';
    case 'due_this_period':
      return 'Due this period';
    case 'open':
      return 'At risk';
    default:
      return 'At risk';
  }
}

function attentionBadgeClass(kind: SscAttentionKind | null): string {
  if (kind === 'overdue') return 'border-red-300 text-red-800';
  if (kind === 'due_today' || kind === 'due_soon') {
    return 'border-amber-300 text-amber-900';
  }
  return 'border-border text-muted-foreground';
}

type Props = {
  functionKey: SscFunction;
  entityId?: string | null;
  firmWide?: boolean;
  glance: SscFunctionHomeGlance;
  purpose: string;
};

function checklistHref(
  functionKey: SscFunction,
  entityId: string | null | undefined,
  extra?: Record<string, string>,
) {
  const qs = new URLSearchParams({
    function: functionKey,
    scope: entityId ? 'single' : 'parent_subs',
    period: 'monthly',
    time: 'active',
    ...extra,
  });
  if (entityId) qs.set('entity', entityId);
  return `/shared-services/checklists?${qs.toString()}`;
}

/**
 * Consistent SSC function home chrome:
 * header → entity → period → capabilities → needs attention → active tasks.
 */
export function SscFunctionHomeChrome({
  functionKey,
  entityId,
  firmWide = true,
  glance,
  purpose,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const entityOptions = getCachedEntitySelectOptions().map((o) => ({
    value: o.value,
    label: o.label,
  }));

  const selectValue = entityId?.trim() || CONSOLIDATED_SELECT_VALUE;

  function setEntity(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (!next || next === CONSOLIDATED_SELECT_VALUE) {
      params.delete('entity');
    } else {
      params.set('entity', next);
    }
    const q = params.toString();
    startTransition(() => {
      router.replace(q ? `${pathname}?${q}` : pathname);
    });
  }

  function setTime(time: SscTimeNav) {
    const href = checklistHref(functionKey, entityId, { time });
    startTransition(() => {
      router.push(href);
    });
  }

  const scopeLabel = entityId
    ? entitySelectLabel(entityId)
    : 'Consolidated';

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
          Shared Services
        </p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          {functionLabel(functionKey)}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{purpose}</p>
        <p className="text-xs text-muted-foreground">
          Scope: {scopeLabel} · Period {glance.period_key}
        </p>
      </div>

      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-end gap-3 border-b border-border/60 bg-background/95 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        {firmWide ? (
          <label className="space-y-1 text-xs text-muted-foreground">
            <span className="block">Company</span>
            <CompanySelect
              value={selectValue}
              onChange={setEntity}
              allowConsolidated
              options={entityOptions}
              className="min-w-[14rem]"
            />
          </label>
        ) : null}
        <div className="flex flex-wrap gap-1">
          {(['active', 'future'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTime(t)}
              className={cn(
                'h-9 rounded-md border px-3 text-sm',
                t === 'active'
                  ? 'border-[#3a414f] bg-[#3a414f] text-white'
                  : 'border-border bg-background text-foreground hover:bg-muted',
              )}
            >
              {timeNavLabel(t)}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-x-3 gap-y-1 text-sm">
          <Link
            href={checklistHref(functionKey, entityId, { overdue: '1' })}
            className="font-medium underline-offset-2 hover:underline"
          >
            Overdue ({glance.overdue_count})
          </Link>
          <Link
            href={checklistHref(functionKey, entityId)}
            className="underline-offset-2 hover:underline"
          >
            Open tasks ({glance.open_count})
          </Link>
          <Link
            href={`/shared-services/audits?function=${functionKey}&scope=${entityId ? 'single' : 'parent_subs'}${entityId ? `&entity=${entityId}` : ''}`}
            className="text-muted-foreground underline-offset-2 hover:underline"
          >
            Audits
          </Link>
          <Link
            href="/shared-services"
            className="text-muted-foreground underline-offset-2 hover:underline"
          >
            SSC hub
          </Link>
        </div>
      </div>

      <SscFunctionCapabilities
        functionKey={functionKey}
        entityId={entityId}
      />

      {pending ? (
        <div className="space-y-2" aria-busy="true" aria-label="Updating list">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : glance.error ? (
        <ErrorState
          title="Could not load tasks"
          description={glance.error}
          onRetryHref={pathname}
          onRetryLabel="Retry"
        />
      ) : (
        <>
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-[#3a414f]">
                Needs attention
              </h2>
              <Badge variant="outline">
                {glance.needs_attention.length} overdue / due soon / open
              </Badge>
            </div>
            {glance.needs_attention.length === 0 ? (
              <EmptyState
                title="Nothing needing attention"
                description="No open active-period work for this scope."
                action={
                  <Link
                    href={checklistHref(functionKey, entityId)}
                    className="text-sm font-medium underline-offset-2 hover:underline"
                  >
                    Open active checklist →
                  </Link>
                }
              />
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border text-sm">
                {glance.needs_attention.map((t) => (
                  <li
                    key={t.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{t.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.company_name}
                        {t.due_date ? ` · due ${t.due_date}` : ''}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={attentionBadgeClass(t.attention_kind)}
                    >
                      {attentionBadgeLabel(t.attention_kind)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-[#3a414f]">
              Active tasks
            </h2>
            {glance.open_tasks.length === 0 ? (
              <EmptyState
                title="No open tasks for this scope"
                description="Seed the period checklist or pick another company."
                action={
                  <Link
                    href={checklistHref(functionKey, entityId)}
                    className="text-sm font-medium underline-offset-2 hover:underline"
                  >
                    Open checklist →
                  </Link>
                }
              />
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border text-sm">
                {glance.open_tasks.slice(0, 12).map((t) => (
                  <li
                    key={t.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5"
                  >
                    <span className="truncate">{t.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {t.company_name}
                      {t.due_date ? ` · ${t.due_date}` : ''}
                      {t.is_overdue ? ' · overdue' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              Complete checkoff and evidence on the{' '}
              <Link
                href={checklistHref(functionKey, entityId)}
                className="font-medium underline-offset-2 hover:underline"
              >
                active checklist
              </Link>
              . Deep tools for {functionLabel(functionKey)} stay below.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
