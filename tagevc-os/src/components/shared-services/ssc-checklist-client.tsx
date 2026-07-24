'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CompanySelect } from '@/components/shared/company-select';
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
  type SscFunction,
  type SscPeriodType,
  type SscScopeMode,
  type SscTaskStatus,
} from '@/lib/shared-services/ssc-checklist/types';
import { listSscCompanies } from '@/lib/shared-services/ssc-checklist/scope';

type Props = {
  bundle: SscOperatorBundle;
  canWrite: boolean;
  mode?: 'checklists' | 'audits';
};

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
const STATUSES: Array<SscTaskStatus | 'all'> = [
  'all',
  'not_started',
  'in_progress',
  'done',
  'blocked',
  'waived',
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
  const q = bundle.query;
  const companies = useMemo(() => listSscCompanies(), []);

  function navigate(patch: Record<string, string>) {
    const params = new URLSearchParams();
    const next = {
      function: q.function,
      period: q.period_type,
      scope: q.scope_mode,
      time: q.time_nav,
      entity: q.single_entity_id ?? '',
      status: q.status ?? 'all',
      owner: q.owner_role ?? 'all',
      company: q.company_entity_id ?? 'all',
      risk: q.risk ?? 'all',
      ...patch,
    };
    for (const [k, v] of Object.entries(next)) {
      if (v && v !== 'all' && !(k === 'entity' && next.scope !== 'single')) {
        params.set(k, v);
      }
      if (k === 'function' || k === 'period' || k === 'scope' || k === 'time') {
        params.set(k, v);
      }
    }
    const base =
      mode === 'audits'
        ? '/shared-services/audits'
        : '/shared-services/checklists';
    router.push(`${base}?${params.toString()}`);
  }

  function onTaskStatus(taskId: string, status: SscTaskStatus) {
    startTransition(async () => {
      const res = await updateSscChecklistTaskAction({
        task_id: taskId,
        status,
        evidence_note: notes[taskId] ?? null,
      });
      setMessage(res.ok ? 'Task updated' : res.error ?? 'Update failed');
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
      setMessage(res.ok ? 'Audit item updated' : res.error ?? 'Update failed');
      router.refresh();
    });
  }

  const firm = bundle.monitoring.find((m) => m.function_key === 'all');

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
            {mode === 'audits'
              ? 'SSC Audits'
              : 'Shared Services Checklists'}
          </h1>
          <Badge variant="outline">{bundle.contract_version}</Badge>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Operate Finance, HR, IT, Marketing, and Legal for Tage and
          subsidiaries from Tage alone. Period checklists, startup/annual
          audits, AI drafts, and sync hooks — human approval on high-risk
          actions.
        </p>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            href="/shared-services/checklists"
            className="text-[#3a414f] underline-offset-2 hover:underline"
          >
            Checklists
          </Link>
          <span className="text-muted-foreground">·</span>
          <Link
            href="/shared-services/audits"
            className="text-[#3a414f] underline-offset-2 hover:underline"
          >
            Audits
          </Link>
          <span className="text-muted-foreground">·</span>
          <Link
            href="/shared-services"
            className="text-[#3a414f] underline-offset-2 hover:underline"
          >
            Shared Services hub
          </Link>
        </div>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>
            {scopeLabel(q.scope_mode)} · {periodLabel(q.period_type)}{' '}
            {bundle.period_key} · {bundle.time_nav} · due {bundle.due_at}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Function</span>
            <select
              className="h-9 w-full rounded-md border border-border bg-background px-2"
              value={q.function}
              onChange={(e) => navigate({ function: e.target.value })}
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
            <select
              className="h-9 w-full rounded-md border border-border bg-background px-2"
              value={q.time_nav}
              onChange={(e) => navigate({ time: e.target.value })}
            >
              <option value="past">Past</option>
              <option value="current">Current</option>
              <option value="future">Future</option>
            </select>
          </label>
          {mode === 'checklists' ? (
            <>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Status</span>
                <select
                  className="h-9 w-full rounded-md border border-border bg-background px-2"
                  value={q.status ?? 'all'}
                  onChange={(e) => navigate({ status: e.target.value })}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s === 'all' ? 'All statuses' : statusLabel(s)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Owner role</span>
                <select
                  className="h-9 w-full rounded-md border border-border bg-background px-2"
                  value={q.owner_role ?? 'all'}
                  onChange={(e) => navigate({ owner: e.target.value })}
                >
                  <option value="all">All owners</option>
                  <option value="service_lead">Service lead</option>
                  <option value="coo">COO</option>
                  <option value="counsel_ops">Counsel / Ops</option>
                  <option value="partner">Partner</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Company filter</span>
                <select
                  className="h-9 w-full rounded-md border border-border bg-background px-2"
                  value={q.company_entity_id ?? 'all'}
                  onChange={(e) => navigate({ company: e.target.value })}
                >
                  <option value="all">All companies</option>
                  {companies.map((c) => (
                    <option key={c.entity_id} value={c.entity_id}>
                      {c.company_name}
                    </option>
                  ))}
                </select>
              </label>
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
            </>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(mode === 'checklists'
          ? bundle.monitoring.filter(
              (m) =>
                q.function === 'all' ||
                m.function_key === 'all' ||
                m.function_key === q.function,
            )
          : bundle.monitoring.filter((m) => m.function_key === 'all')
        ).map((m) => (
          <Card key={m.function_key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                {functionLabel(m.function_key)}
              </CardTitle>
              <CardDescription>{m.trend_label}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span>Completion</span>
                <strong>{m.completion_pct}%</strong>
              </div>
              <div className="flex items-center justify-between">
                <span>Overdue</span>
                <span>{m.overdue_tasks}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Blocked</span>
                <span>{m.blocked_tasks}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Audit open</span>
                <span>{m.audit_open_items}</span>
              </div>
              <Badge className={badgeForRisk(m.risk_badge)}>
                {m.risk_badge} risk
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI period briefing</CardTitle>
          <CardDescription>
            Draft recommendations only — confirm before approvals or high-risk
            actions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>{bundle.ai.summary}</p>
          <p className="text-muted-foreground">{bundle.ai.impact}</p>
          <div>
            <div className="mb-1 font-medium">Recommended order</div>
            <ol className="list-decimal space-y-1 pl-5">
              {bundle.ai.recommended_order.length ? (
                bundle.ai.recommended_order.map((x) => (
                  <li key={x}>{x}</li>
                ))
              ) : (
                <li>No open items in this view.</li>
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
          <div className="flex flex-wrap gap-2">
            {bundle.ai.guardrails.map((g) => (
              <Badge key={g} variant="outline">
                {g}
              </Badge>
            ))}
          </div>
          {firm ? (
            <p className="text-xs text-muted-foreground">
              Firm readiness {firm.completion_pct}% · {firm.overdue_tasks}{' '}
              overdue · {firm.blocked_tasks} blocked
            </p>
          ) : null}
        </CardContent>
      </Card>

      {mode === 'checklists' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Checklist tasks ({bundle.tasks.length})
            </CardTitle>
            <CardDescription>
              {bundle.generated
                ? 'Instances generated/refreshed for this period.'
                : 'Using existing period instances.'}{' '}
              Check off work and attach evidence.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {message ? (
              <p className="text-sm text-muted-foreground">{message}</p>
            ) : null}
            {bundle.tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No tasks for this selection yet. Future periods pre-generate on
                open; try Current or regenerate by refreshing.
              </p>
            ) : (
              bundle.tasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-md border border-border p-3 space-y-2"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{task.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {functionLabel(task.function_key)} · {task.company_name}{' '}
                        · owner {task.owner_role} · due {task.due_date ?? '—'}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {task.is_overdue ? (
                        <Badge className="bg-red-100 text-red-800">
                          Overdue
                        </Badge>
                      ) : null}
                      <Badge variant="outline">{task.risk_level}</Badge>
                      <Badge variant="outline">
                        {statusLabel(task.status)}
                      </Badge>
                      <Badge variant="outline">{task.automation_source}</Badge>
                    </div>
                  </div>
                  {task.description ? (
                    <p className="text-sm text-muted-foreground">
                      {task.description}
                    </p>
                  ) : null}
                  {task.ai_suggestion ? (
                    <p className="text-xs text-[#3a414f]">
                      AI: {task.ai_suggestion}
                    </p>
                  ) : null}
                  <textarea
                    className="min-h-[60px] w-full rounded-md border border-border bg-background p-2 text-sm"
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
                    {(
                      [
                        'in_progress',
                        'done',
                        'blocked',
                        'waived',
                        'not_started',
                      ] as SscTaskStatus[]
                    ).map((st) => (
                      <button
                        key={st}
                        type="button"
                        disabled={!canWrite || pending}
                        className="h-8 rounded-md border border-border px-2 text-xs disabled:opacity-50"
                        onClick={() => onTaskStatus(task.id, st)}
                      >
                        {statusLabel(st)}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {bundle.audits.map((audit) => (
            <Card key={audit.id}>
              <CardHeader>
                <CardTitle className="text-base">{audit.title}</CardTitle>
                <CardDescription>
                  {audit.company_name} · {audit.audit_type} ·{' '}
                  {audit.completion_pct}% · {audit.open_item_count} open ·{' '}
                  {audit.period_key}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {audit.items.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-md border border-border p-3 space-y-2"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">{item.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {functionLabel(item.function_key)} · owner{' '}
                          {item.owner_role}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Badge variant="outline">{item.risk_level}</Badge>
                        <Badge variant="outline">
                          {statusLabel(item.status)}
                        </Badge>
                      </div>
                    </div>
                    {item.ai_finding_draft ? (
                      <p className="text-xs text-[#3a414f]">
                        AI draft: {item.ai_finding_draft}
                      </p>
                    ) : null}
                    <textarea
                      className="min-h-[60px] w-full rounded-md border border-border bg-background p-2 text-sm"
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
                      {(
                        [
                          'in_progress',
                          'done',
                          'blocked',
                          'waived',
                        ] as SscTaskStatus[]
                      ).map((st) => (
                        <button
                          key={st}
                          type="button"
                          disabled={!canWrite || pending}
                          className="h-8 rounded-md border border-border px-2 text-xs disabled:opacity-50"
                          onClick={() => onAuditStatus(item.id, st)}
                        >
                          {statusLabel(st)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Subsidiary sync hooks (Tage only)
          </CardTitle>
          <CardDescription>
            Data pulls into Tage for SSC completion — no SSC UI in subsidiary
            portals.
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
    </div>
  );
}
