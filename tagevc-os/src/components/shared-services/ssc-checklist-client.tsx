'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CompanySelect } from '@/components/shared/company-select';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  updateSscAuditItemAction,
  updateSscChecklistTaskAction,
} from '@/app/(app)/shared-services/checklists/actions';
import type { SscOperatorBundle } from '@/lib/shared-services/ssc-checklist/engine';
import {
  functionLabel,
  periodLabel,
  scopeLabel,
  statusLabel,
  functionHomeHref,
  type SscFunction,
  type SscPeriodType,
  type SscScopeMode,
  type SscTaskStatus,
} from '@/lib/shared-services/ssc-checklist/types';
import { listSscCompanies } from '@/lib/shared-services/ssc-checklist/scope';
import { sparklineBars } from '@/lib/shared-services/ssc-checklist/types';
import {
  timeNavLabel,
  type SscTimeNav,
} from '@/lib/shared-services/ssc-checklist/period';

type Props = {
  bundle: SscOperatorBundle;
  canWrite: boolean;
  mode?: 'checklists' | 'audits';
};

type Tab = 'overview' | 'tasks' | 'audits' | 'sync';

const TASK_WINDOW = 60;

const FUNCTIONS: Array<SscFunction | 'all'> = [
  'all',
  'finance',
  'hr',
  'it',
  'marketing',
  'legal',
];
const PERIODS: SscPeriodType[] = [
  'weekly',
  'as_needed',
  'monthly',
  'quarterly',
  'annual',
];
const SCOPES: SscScopeMode[] = [
  'parent',
  'parent_subs',
  'subs',
  'single',
];

function badgeForRisk(b: 'green' | 'amber' | 'red') {
  if (b === 'green') return 'bg-emerald-100 text-emerald-800';
  if (b === 'amber') return 'bg-amber-100 text-amber-900';
  return 'bg-red-100 text-red-800';
}

export function SscChecklistClient({
  bundle,
  canWrite,
  mode = 'checklists',
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(
    mode === 'audits' ? 'audits' : 'tasks',
  );
  const [groupBy, setGroupBy] = useState<'function' | 'company' | 'status'>(
    'function',
  );
  const [taskLimit, setTaskLimit] = useState(TASK_WINDOW);
  const q = bundle.query;
  /** Optimistic function selection — avoids controlled-select snap-back while RSC reloads. */
  const [functionFilter, setFunctionFilter] = useState<SscFunction | 'all'>(
    q.function,
  );
  const companies = useMemo(() => listSscCompanies(), []);
  const firm = bundle.monitoring.find((m) => m.function_key === 'all');

  useEffect(() => {
    setFunctionFilter(q.function);
    setTaskLimit(TASK_WINDOW);
  }, [
    q.function,
    q.period_type,
    q.scope_mode,
    q.time_nav,
    q.status,
    q.owner_role,
    q.company_entity_id,
    q.risk,
    q.overdue_only,
  ]);

  function navigate(patch: Record<string, string>) {
    const params = new URLSearchParams();
    const next = {
      function: functionFilter,
      period: q.period_type,
      scope: q.scope_mode,
      time: q.time_nav === 'past' || q.time_nav === 'current' ? 'active' : q.time_nav,
      entity: q.single_entity_id ?? '',
      status: q.status ?? 'all',
      owner: q.owner_role ?? 'all',
      company: q.company_entity_id ?? 'all',
      risk: q.risk ?? 'all',
      overdue: q.overdue_only ? '1' : '',
      ...patch,
    };
    params.set('function', next.function);
    params.set('period', next.period);
    params.set('scope', next.scope);
    params.set('time', next.time);
    if (next.scope === 'single' && next.entity) params.set('entity', next.entity);
    if (next.status && next.status !== 'all') params.set('status', next.status);
    if (next.owner && next.owner !== 'all') params.set('owner', next.owner);
    if (next.company && next.company !== 'all') params.set('company', next.company);
    if (next.risk && next.risk !== 'all') params.set('risk', next.risk);
    if (next.overdue === '1') params.set('overdue', '1');
    const base =
      mode === 'audits'
        ? '/shared-services/audits'
        : '/shared-services/checklists';
    startTransition(() => {
      router.push(`${base}?${params.toString()}`);
    });
  }

  function onTaskStatus(taskId: string, status: SscTaskStatus) {
    startTransition(async () => {
      const res = await updateSscChecklistTaskAction({
        task_id: taskId,
        status,
        evidence_note: notes[taskId] ?? null,
      });
      setMessage(res.ok ? 'Saved' : res.error ?? 'Update failed');
      router.refresh();
    });
  }

  function onAuditStatus(itemId: string, status: SscTaskStatus) {
    startTransition(async () => {
      const res = await updateSscAuditItemAction({
        item_id: itemId,
        status,
        evidence_note: notes[itemId] ?? null,
      });
      setMessage(res.ok ? 'Saved' : res.error ?? 'Update failed');
      router.refresh();
    });
  }

  const visibleTasks = useMemo(() => {
    if (functionFilter === 'all') return bundle.tasks;
    return bundle.tasks.filter((t) => t.function_key === functionFilter);
  }, [bundle.tasks, functionFilter]);

  const visibleAudits = useMemo(() => {
    if (functionFilter === 'all') return bundle.audits;
    return bundle.audits
      .map((audit) => ({
        ...audit,
        items: audit.items.filter(
          (item) =>
            item.function_key === functionFilter ||
            item.function_key === 'cross',
        ),
      }))
      .filter((audit) => audit.items.length > 0);
  }, [bundle.audits, functionFilter]);

  const groupedTasks = useMemo(() => {
    const map = new Map<string, typeof visibleTasks>();
    for (const task of visibleTasks) {
      const key =
        groupBy === 'company'
          ? task.company_name
          : groupBy === 'status'
            ? statusLabel(task.status)
            : functionLabel(task.function_key);
      const list = map.get(key) ?? [];
      list.push(task);
      map.set(key, list);
    }
    // Window per group so All still surfaces every function group.
    return [...map.entries()].map(
      ([group, tasks]) => [group, tasks.slice(0, taskLimit)] as const,
    );
  }, [visibleTasks, groupBy, taskLimit]);

  const hiddenTaskCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of visibleTasks) {
      const key =
        groupBy === 'company'
          ? task.company_name
          : groupBy === 'status'
            ? statusLabel(task.status)
            : functionLabel(task.function_key);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    let hidden = 0;
    for (const count of map.values()) {
      hidden += Math.max(0, count - taskLimit);
    }
    return hidden;
  }, [visibleTasks, groupBy, taskLimit]);

  const overdueCount = visibleTasks.filter((t) => t.is_overdue).length;

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'tasks', label: 'Tasks', count: visibleTasks.length },
    {
      id: 'audits',
      label: 'Audits',
      count: visibleAudits.reduce((s, a) => s + a.items.filter((i) => i.status !== 'done' && i.status !== 'waived').length, 0),
    },
    { id: 'sync', label: 'Data sync', count: bundle.sync.length },
  ];

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
                {mode === 'audits' ? 'SSC Audits' : 'SSC Checklists'}
              </h1>
              <Badge variant="outline">
                {bundle.ai.provider === 'openai' ? 'AI · OpenAI' : 'AI · rules'}
              </Badge>
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {scopeLabel(q.scope_mode)} · {periodLabel(q.period_type)}{' '}
              {bundle.period_key} · {timeNavLabel(bundle.time_nav)} · due{' '}
              {bundle.due_at}
            </p>
          </div>
          <Link
            href="/shared-services"
            className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            ← Shared Services Center
          </Link>
        </div>

        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`h-9 rounded-md border px-3 text-sm ${
                tab === t.id
                  ? 'border-[#3a414f] bg-[#3a414f] text-white'
                  : 'border-border bg-background'
              }`}
            >
              {t.label}
              {typeof t.count === 'number' ? ` (${t.count})` : ''}
            </button>
          ))}
          {mode === 'checklists' ? (
            <>
              <button
                type="button"
                className={`h-9 rounded-md border px-3 text-sm ${
                  q.overdue_only
                    ? 'border-red-700 bg-red-700 text-white'
                    : 'border-border bg-background'
                }`}
                onClick={() =>
                  navigate({ overdue: q.overdue_only ? '' : '1' })
                }
              >
                Overdue{overdueCount ? ` (${overdueCount})` : ''}
              </button>
              <button
                type="button"
                className="h-9 rounded-md border border-border bg-background px-3 text-sm"
                onClick={() => navigate({ overdue: '', status: 'all', risk: 'all' })}
              >
                Clear filters
              </button>
            </>
          ) : null}
        </div>
      </header>

      <Card className="sticky top-0 z-10 border-border/80 bg-background/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <CardContent className="grid gap-3 pt-4 md:grid-cols-3 lg:grid-cols-6">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Function</span>
            <select
              className="h-9 w-full rounded-md border border-border bg-background px-2"
              value={functionFilter}
              onChange={(e) => {
                const next = e.target.value as SscFunction | 'all';
                setFunctionFilter(next);
                setTaskLimit(TASK_WINDOW);
                navigate({ function: next });
              }}
            >
              {FUNCTIONS.map((f) => (
                <option key={f} value={f}>
                  {functionLabel(f)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Scope</span>
            <select
              className="h-9 w-full rounded-md border border-border bg-background px-2"
              value={q.scope_mode}
              onChange={(e) => navigate({ scope: e.target.value })}
            >
              {SCOPES.map((s) => (
                <option key={s} value={s}>
                  {scopeLabel(s)}
                </option>
              ))}
            </select>
          </label>
          {q.scope_mode === 'single' ? (
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Company</span>
              <CompanySelect
                value={q.single_entity_id ?? 'ENT-FIRM'}
                onChange={(v) => navigate({ entity: v, scope: 'single' })}
                options={companies.map((c) => ({
                  value: c.entity_id,
                  label: c.company_name,
                }))}
              />
            </label>
          ) : null}
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Period</span>
            <select
              className="h-9 w-full rounded-md border border-border bg-background px-2"
              value={q.period_type}
              onChange={(e) => navigate({ period: e.target.value })}
            >
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  {periodLabel(p)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Time</span>
            <div className="flex h-9 overflow-hidden rounded-md border border-border">
              {(['active', 'future'] as const satisfies readonly SscTimeNav[]).map(
                (t) => (
                  <button
                    key={t}
                    type="button"
                    className={`flex-1 text-xs ${
                      q.time_nav === t ||
                      (t === 'active' &&
                        (q.time_nav === 'past' || q.time_nav === 'current'))
                        ? 'bg-[#3a414f] text-white'
                        : 'bg-background'
                    }`}
                    onClick={() => navigate({ time: t })}
                  >
                    {timeNavLabel(t)}
                  </button>
                ),
              )}
            </div>
          </label>
          {mode === 'checklists' ? (
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Risk</span>
              <select
                className="h-9 w-full rounded-md border border-border bg-background px-2"
                value={q.risk ?? 'all'}
                onChange={(e) => navigate({ risk: e.target.value })}
              >
                <option value="all">All risk</option>
                <option value="high_plus">High + critical</option>
              </select>
            </label>
          ) : null}
        </CardContent>
      </Card>

      {message ? (
        <p className="text-sm text-muted-foreground">{message}</p>
      ) : null}

      {tab === 'overview' ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(functionFilter === 'all'
              ? bundle.monitoring
              : bundle.monitoring.filter(
                  (m) =>
                    m.function_key === 'all' ||
                    m.function_key === functionFilter,
                )
            ).map((m) => {
              const trend = bundle.trends.find(
                (t) => t.function_key === m.function_key,
              );
              return (
                <Card key={m.function_key}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      {functionLabel(m.function_key)}
                    </CardTitle>
                    <CardDescription>{m.trend_label}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span>Done</span>
                      <strong>{m.completion_pct}%</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Overdue / blocked</span>
                      <span>
                        {m.overdue_tasks} / {m.blocked_tasks}
                      </span>
                    </div>
                    {trend ? (
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span className="font-mono tracking-tight">
                          {sparklineBars(trend.sparkline)}
                        </span>
                        <span>
                          {trend.delta_completion != null
                            ? `${trend.delta_completion >= 0 ? '+' : ''}${trend.delta_completion}pts`
                            : '—'}
                        </span>
                      </div>
                    ) : null}
                    <Badge className={badgeForRisk(m.risk_badge)}>
                      {m.risk_badge}
                    </Badge>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {bundle.packages.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Subsidiary completion packages
                </CardTitle>
                <CardDescription>
                  Intake freshness for SSC evidence — no subsidiary SSC UI.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2">
                {bundle.packages.slice(0, 8).map((p) => (
                  <div
                    key={`${p.entity_id}:${p.package_key}:${p.period_key}`}
                    className="rounded-md border border-border p-3 text-sm"
                  >
                    <div className="font-medium">
                      {p.company_name} · {p.package_key}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge variant="outline">{p.status}</Badge>
                      {p.stale ? (
                        <Badge className="bg-amber-100 text-amber-900">
                          Stale
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Freshness{' '}
                      {p.freshness_at
                        ? p.freshness_at.slice(0, 16).replace('T', ' ')
                        : 'unknown'}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">AI period briefing</CardTitle>
              <CardDescription>
                Draft only · provider {bundle.ai.provider ?? 'rules'} · human
                confirmation on high-risk actions
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>{bundle.ai.summary}</p>
              <p className="text-muted-foreground">{bundle.ai.impact}</p>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-1 font-medium">Recommended order</div>
                  <ol className="list-decimal space-y-1 pl-5">
                    {bundle.ai.recommended_order.length ? (
                      bundle.ai.recommended_order.map((x) => (
                        <li key={x}>{x}</li>
                      ))
                    ) : (
                      <li>No open items.</li>
                    )}
                  </ol>
                </div>
                <div>
                  <div className="mb-1 font-medium">Next actions</div>
                  <ul className="list-disc space-y-1 pl-5">
                    {bundle.ai.next_actions.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {bundle.ai.guardrails.map((g) => (
                  <Badge key={g} variant="outline">
                    {g}
                  </Badge>
                ))}
              </div>
              {bundle.escalation.created > 0 || bundle.escalation.scanned > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Escalation this load: scanned {bundle.escalation.scanned},
                  created {bundle.escalation.created} ticket(s), notifications{' '}
                  {bundle.escalation.notifications ?? 0}, skipped{' '}
                  {bundle.escalation.skipped}
                  {bundle.escalation.ticket_ids.length
                    ? ` · ${bundle.escalation.ticket_ids.join(', ')}`
                    : ''}
                </p>
              ) : null}
              {firm ? (
                <p className="text-xs text-muted-foreground">
                  Firm {firm.completion_pct}% · {firm.overdue_tasks} overdue ·{' '}
                  {firm.audit_open_items} audit open
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === 'tasks' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2 text-sm">
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground">Status</span>
                <select
                  className="h-8 rounded-md border border-border bg-background px-2"
                  value={q.status ?? 'all'}
                  onChange={(e) => navigate({ status: e.target.value })}
                >
                  <option value="all">All</option>
                  <option value="not_started">Not started</option>
                  <option value="in_progress">In progress</option>
                  <option value="done">Done</option>
                  <option value="blocked">Blocked</option>
                  <option value="waived">Waived</option>
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground">Owner</span>
                <select
                  className="h-8 rounded-md border border-border bg-background px-2"
                  value={q.owner_role ?? 'all'}
                  onChange={(e) => navigate({ owner: e.target.value })}
                >
                  <option value="all">All</option>
                  <option value="service_lead">Service lead</option>
                  <option value="coo">COO</option>
                  <option value="counsel_ops">Counsel</option>
                  <option value="partner">Partner</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground">Company</span>
                <select
                  className="h-8 rounded-md border border-border bg-background px-2"
                  value={q.company_entity_id ?? 'all'}
                  onChange={(e) => navigate({ company: e.target.value })}
                >
                  <option value="all">All</option>
                  {companies.map((c) => (
                    <option key={c.entity_id} value={c.entity_id}>
                      {c.company_name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Group</span>
              <select
                className="h-8 rounded-md border border-border bg-background px-2"
                value={groupBy}
                onChange={(e) =>
                  setGroupBy(e.target.value as typeof groupBy)
                }
              >
                <option value="function">Function</option>
                <option value="company">Company</option>
                <option value="status">Status</option>
              </select>
            </label>
          </div>

          {groupedTasks.length === 0 ? (
            <EmptyState
              title="No tasks for this selection"
              description="Try Active period, clear Overdue, or open All functions. Escalations still appear in tickets when AUTO/DRAFT applies."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    className="h-8 rounded-md border border-border bg-background px-3 text-sm"
                    onClick={() =>
                      navigate({
                        time: 'active',
                        overdue: '',
                        status: 'all',
                        risk: 'all',
                      })
                    }
                  >
                    Reset to Active
                  </button>
                  <Link
                    href="/shared-services"
                    className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm"
                  >
                    SSC hub
                  </Link>
                </div>
              }
            />
          ) : (
            <>
            {groupedTasks.map(([group, tasks]) => (
              <Card key={group}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    {group}{' '}
                    <span className="text-muted-foreground font-normal">
                      ({tasks.length})
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {tasks.map((task) => (
                    <div
                      key={task.id}
                      className="rounded-md border border-border p-3 space-y-2"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="font-medium">{task.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {task.company_name} · {task.owner_role} · due{' '}
                            {task.due_date ?? '—'}
                            {task.function_key ? (
                              <>
                                {' '}
                                ·{' '}
                                <Link
                                  href={functionHomeHref(task.function_key)}
                                  className="underline-offset-2 hover:underline"
                                >
                                  function home
                                </Link>
                              </>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {task.is_overdue ? (
                            <Badge className="bg-red-100 text-red-800">
                              Overdue
                            </Badge>
                          ) : null}
                          {task.evidence_ticket_id ? (
                            <Badge className="bg-amber-100 text-amber-900">
                              Escalated to ticket
                            </Badge>
                          ) : null}
                          <Badge variant="outline">{task.risk_level}</Badge>
                          <Badge variant="outline">
                            {statusLabel(task.status)}
                          </Badge>
                        </div>
                      </div>
                      {task.ai_suggestion ? (
                        <p className="text-xs text-[#3a414f]">
                          {task.ai_suggestion}
                        </p>
                      ) : null}
                      <textarea
                        className="min-h-[52px] w-full rounded-md border border-border bg-background p-2 text-sm"
                        placeholder="Notes / evidence"
                        value={notes[task.id] ?? task.evidence_note ?? ''}
                        onChange={(e) =>
                          setNotes((prev) => ({
                            ...prev,
                            [task.id]: e.target.value,
                          }))
                        }
                        disabled={!canWrite || pending}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={!canWrite || pending}
                          className="h-8 rounded-md bg-[#3a414f] px-3 text-xs text-white disabled:opacity-50"
                          onClick={() => onTaskStatus(task.id, 'done')}
                        >
                          Mark done
                        </button>
                        <button
                          type="button"
                          disabled={!canWrite || pending}
                          className="h-8 rounded-md border border-border px-2 text-xs disabled:opacity-50"
                          onClick={() => onTaskStatus(task.id, 'in_progress')}
                        >
                          In progress
                        </button>
                        <button
                          type="button"
                          disabled={!canWrite || pending}
                          className="h-8 rounded-md border border-border px-2 text-xs disabled:opacity-50"
                          onClick={() => onTaskStatus(task.id, 'blocked')}
                        >
                          Blocked
                        </button>
                        <button
                          type="button"
                          disabled={!canWrite || pending}
                          className="h-8 rounded-md border border-border px-2 text-xs disabled:opacity-50"
                          onClick={() => onTaskStatus(task.id, 'waived')}
                        >
                          Waive
                        </button>
                        {task.evidence_ticket_id ? (
                          <Link
                            href={`/shared-services/tickets/${task.evidence_ticket_id}`}
                            className="inline-flex h-8 items-center text-xs underline-offset-2 hover:underline"
                          >
                            Open ticket
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
            {hiddenTaskCount > 0 ? (
              <button
                type="button"
                className="h-9 w-full rounded-md border border-border bg-background text-sm"
                onClick={() => setTaskLimit((n) => n + TASK_WINDOW)}
              >
                Show more tasks ({hiddenTaskCount} remaining)
              </button>
            ) : null}
            </>
          )}
        </div>
      ) : null}

      {tab === 'audits' ? (
        <div className="space-y-4">
          {visibleAudits.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-sm text-muted-foreground">
                No audits in scope yet.
              </CardContent>
            </Card>
          ) : (
            visibleAudits.map((audit) => (
              <Card key={audit.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base">{audit.title}</CardTitle>
                    <Badge variant="outline">{audit.audit_type}</Badge>
                    <Badge variant="outline">{audit.completion_pct}%</Badge>
                  </div>
                  <CardDescription>
                    {audit.company_name} · {audit.open_item_count} open ·{' '}
                    {audit.period_key}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {audit.items.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-md border border-border p-3 space-y-2"
                    >
                      <div className="flex flex-wrap justify-between gap-2">
                        <div>
                          <div className="font-medium">{item.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {functionLabel(item.function_key)} · {item.owner_role}
                          </div>
                        </div>
                        <Badge variant="outline">
                          {statusLabel(item.status)}
                        </Badge>
                      </div>
                      {item.ai_finding_draft ? (
                        <p className="text-xs text-[#3a414f]">
                          {item.ai_finding_draft}
                        </p>
                      ) : null}
                      <textarea
                        className="min-h-[52px] w-full rounded-md border border-border bg-background p-2 text-sm"
                        placeholder="Evidence / finding notes"
                        value={notes[item.id] ?? item.evidence_note ?? ''}
                        onChange={(e) =>
                          setNotes((prev) => ({
                            ...prev,
                            [item.id]: e.target.value,
                          }))
                        }
                        disabled={!canWrite || pending}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={!canWrite || pending}
                          className="h-8 rounded-md bg-[#3a414f] px-3 text-xs text-white disabled:opacity-50"
                          onClick={() => onAuditStatus(item.id, 'done')}
                        >
                          Mark done
                        </button>
                        <button
                          type="button"
                          disabled={!canWrite || pending}
                          className="h-8 rounded-md border border-border px-2 text-xs disabled:opacity-50"
                          onClick={() => onAuditStatus(item.id, 'in_progress')}
                        >
                          In progress
                        </button>
                        <button
                          type="button"
                          disabled={!canWrite || pending}
                          className="h-8 rounded-md border border-border px-2 text-xs disabled:opacity-50"
                          onClick={() => onAuditStatus(item.id, 'blocked')}
                        >
                          Blocked
                        </button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      ) : null}

      {tab === 'sync' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Subsidiary data into Tage
            </CardTitle>
            <CardDescription>
              Sync hooks only — no SSC UI in subsidiary portals.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {bundle.sync.map((s) => (
              <div
                key={`${s.entity_id}:${s.source_key}`}
                className="rounded-md border border-border p-3 text-sm"
              >
                <div className="font-medium">
                  {s.company_name} · {s.source_key}
                </div>
                <Badge variant="outline" className="mt-1">
                  {s.status}
                </Badge>
                <ul className="mt-2 list-disc pl-4 text-muted-foreground">
                  {s.highlights.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
