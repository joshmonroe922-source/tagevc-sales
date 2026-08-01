import { Suspense } from 'react';

import {
  completeTodoAction,
  createIssueAction,
  createRockAction,
  createTodoAction,
  saveScorecardActualAction,
  saveVtoAction,
  updateIssueStatusAction,
  updateRockStatusAction,
} from '@/app/(app)/eos/actions';
import { EosActionForm } from '@/components/eos/eos-action-form';
import { EosScopeToggle } from '@/components/eos/eos-scope-toggle';
import { EosViewModeToggle } from '@/components/eos/eos-view-mode-toggle';
import { L10MeetingsPanel } from '@/components/eos/l10-meetings-panel';
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
import { Textarea } from '@/components/ui/textarea';
import { loadEosDashboard } from '@/lib/eos/dashboard';
import {
  ensureWeeklyL10Meeting,
  listL10Meetings,
} from '@/lib/eos/l10-meetings';
import {
  DEFAULT_L10_AGENDA,
  eosOperatingSystemNavLabel,
} from '@/lib/eos/types';
import { entityDisplayName } from '@/lib/entities/display-name';
import { listOrgProfiles } from '@/lib/org/repo';
import {
  ownerIdsForEosView,
  resolveDefaultEosViewMode,
  type EosViewMode,
} from '@/lib/org/tree';
import { getSessionContext } from '@/lib/rbac/session';
import { cn } from '@/lib/utils';

export default async function EosOperatingSystemPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; view?: string }>;
}) {
  const session = await getSessionContext();
  if (!session) return null;

  const params = await searchParams;
  const viewRaw = (params.view ?? '').trim() as EosViewMode | '';
  const viewMode: EosViewMode =
    viewRaw === 'me' ||
    viewRaw === 'team' ||
    viewRaw === 'entity' ||
    viewRaw === 'consolidated'
      ? viewRaw
      : resolveDefaultEosViewMode(session.profile.role);

  const eos = await loadEosDashboard({
    scope:
      viewMode === 'consolidated'
        ? 'all'
        : params.entity ?? session.profile.entity_id ?? 'ENT-FIRM',
    profileId: session.profile.id,
  });

  const org = await listOrgProfiles();
  const ownerFilter = ownerIdsForEosView(
    viewMode,
    org.profiles,
    session.profile.id,
  );

  const rocks = ownerFilter
    ? eos.rocks.filter(
        (r) => !r.owner_profile_id || ownerFilter.has(r.owner_profile_id),
      )
    : eos.rocks;
  const issues = ownerFilter
    ? eos.issues.filter(
        (i) => !i.owner_profile_id || ownerFilter.has(i.owner_profile_id),
      )
    : eos.issues;
  const todos = ownerFilter
    ? eos.todos.filter(
        (t) =>
          !t.assignee_profile_id || ownerFilter.has(t.assignee_profile_id),
      )
    : eos.todos;

  const writeEntityId = eos.isConsolidated ? '' : eos.entityIds[0];
  const title = eos.isConsolidated
    ? 'Consolidated Performance Management'
    : eosOperatingSystemNavLabel(writeEntityId);

  let l10Current = null as Awaited<
    ReturnType<typeof listL10Meetings>
  >['meetings'][number] | null;
  let l10Previous: Awaited<ReturnType<typeof listL10Meetings>>['meetings'] =
    [];
  if (writeEntityId) {
    const listed = await listL10Meetings({
      entityId: writeEntityId,
      ownerProfileId: session.profile.id,
      limit: 16,
    });
    l10Previous = listed.meetings;
    l10Current =
      listed.meetings.find((m) => m.week_key === eos.weekKey) ?? null;
    if (!l10Current && listed.tableReady) {
      const gen = await ensureWeeklyL10Meeting({
        entityId: writeEntityId,
        ownerProfileId: session.profile.id,
        ownerName: session.profile.full_name || session.profile.email,
        weekKey: eos.weekKey,
      });
      if (gen.ok && gen.meeting) {
        l10Current = gen.meeting;
        l10Previous = [gen.meeting, ...listed.meetings];
      }
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
            Human Resources · Traction EOS
          </p>
          <Badge variant="secondary">{eos.quarterKey}</Badge>
          <Badge variant="outline">{eos.weekKey}</Badge>
          <Badge variant="outline">View · {viewMode}</Badge>
          {!eos.tableReady ? (
            <Badge variant="outline">Apply phase84 SQL</Badge>
          ) : null}
        </div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          {title}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Rocks · Scorecard · IDS · Level 10 · V/TO — filter by Me / Team
          (direct reports) / Entity / Consolidated. Visionary firm-wide; SubLead
          entity-scoped.
        </p>
        <Suspense fallback={null}>
          <EosViewModeToggle value={viewMode} showConsolidated />
        </Suspense>
        <Suspense fallback={null}>
          <EosScopeToggle value={eos.scope} />
        </Suspense>
      </header>

      {eos.isConsolidated ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {eos.rollups.map((r) => (
            <Card key={r.entity_id}>
              <CardHeader className="pb-2">
                <CardDescription>
                  {entityDisplayName(r.entity_id)}
                </CardDescription>
                <CardTitle className="text-base">
                  {r.rocks_on_track}/{r.rocks_total} rocks on track
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-xs text-muted-foreground">
                <p>
                  Issues open: {r.issues_open} · To-dos: {r.todos_open}
                </p>
                <p>
                  Scorecard: {r.scorecard_on_track}/{r.scorecard_total} on track
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      <L10MeetingsPanel
        current={l10Current}
        previous={l10Previous}
        entityId={writeEntityId}
        canGenerate={Boolean(writeEntityId)}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Level 10 agenda</CardTitle>
          <CardDescription>
            Same weekly rhythm — each team/level runs its own meeting.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {DEFAULT_L10_AGENDA.map((a) => (
            <Badge key={a.key} variant="outline">
              {a.label} · {a.minutes}m
            </Badge>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {eos.scorecard.map((row) => (
          <Card key={row.id}>
            <CardHeader className="pb-2">
              <CardDescription>
                {eos.isConsolidated
                  ? `${entityDisplayName(row.entity_id)} · ${row.label}`
                  : row.label}
              </CardDescription>
              <CardTitle
                className={cn(
                  'text-2xl',
                  row.on_track === true
                    ? 'text-emerald-700'
                    : row.on_track === false
                      ? 'text-rose-700'
                      : 'text-foreground',
                )}
              >
                {row.actual ?? '—'}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  / {row.goal ?? '—'} {row.unit}
                </span>
              </CardTitle>
            </CardHeader>
            {!eos.isConsolidated ? (
              <CardContent>
                <EosActionForm action={saveScorecardActualAction}>
                  <input type="hidden" name="entity_id" value={writeEntityId} />
                  <input
                    type="hidden"
                    name="metric_key"
                    value={row.metric_key}
                  />
                  <input type="hidden" name="goal" value={row.goal ?? ''} />
                  <Input
                    name="actual"
                    type="number"
                    step="any"
                    placeholder="Actual"
                    className="h-8 w-24"
                    defaultValue={row.actual ?? ''}
                  />
                  <Button type="submit" size="sm" variant="outline">
                    Save
                  </Button>
                </EosActionForm>
              </CardContent>
            ) : null}
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Rocks ({eos.quarterKey}) · {rocks.length}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {writeEntityId ? (
              <EosActionForm action={createRockAction}>
                <input type="hidden" name="entity_id" value={writeEntityId} />
                <Input name="title" placeholder="Rock title" required />
                <Textarea
                  name="detail"
                  placeholder="Optional detail"
                  rows={2}
                />
                <Button type="submit" size="sm">
                  Add rock
                </Button>
              </EosActionForm>
            ) : (
              <p className="text-sm text-muted-foreground">
                Switch to a company scope to add rocks.
              </p>
            )}
            {rocks.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium">{r.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {eos.isConsolidated
                      ? `${entityDisplayName(r.entity_id)} · `
                      : ''}
                    {r.scope} · {r.status}
                  </p>
                </div>
                <EosActionForm action={updateRockStatusAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <select
                    name="status"
                    defaultValue={r.status}
                    className="h-8 rounded-md border px-2 text-xs"
                  >
                    <option value="on_track">On track</option>
                    <option value="off_track">Off track</option>
                    <option value="done">Done</option>
                    <option value="dropped">Dropped</option>
                  </select>
                  <Button type="submit" size="sm" variant="outline">
                    Save
                  </Button>
                </EosActionForm>
              </div>
            ))}
            {rocks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No rocks yet this quarter.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Issues (IDS)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {writeEntityId ? (
              <EosActionForm action={createIssueAction}>
                <input type="hidden" name="entity_id" value={writeEntityId} />
                <Input name="title" placeholder="Issue title" required />
                <Textarea name="detail" placeholder="Detail" rows={2} />
                <select
                  name="priority"
                  defaultValue="medium"
                  className="h-9 rounded-md border px-2 text-sm"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
                <Button type="submit" size="sm">
                  Raise issue
                </Button>
              </EosActionForm>
            ) : (
              <p className="text-sm text-muted-foreground">
                Switch to a company scope to raise issues.
              </p>
            )}
            {issues.map((i) => (
              <div
                key={i.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium">{i.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {eos.isConsolidated
                      ? `${entityDisplayName(i.entity_id)} · `
                      : ''}
                    {i.priority} · {i.status}
                  </p>
                </div>
                <EosActionForm action={updateIssueStatusAction}>
                  <input type="hidden" name="id" value={i.id} />
                  <input type="hidden" name="status" value="solved" />
                  <Button type="submit" size="sm" variant="outline">
                    Solve
                  </Button>
                </EosActionForm>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">L10 to-dos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {writeEntityId ? (
            <EosActionForm action={createTodoAction}>
              <input type="hidden" name="entity_id" value={writeEntityId} />
              <Input name="title" placeholder="To-do" required />
              <Button type="submit" size="sm">
                Add to-do
              </Button>
            </EosActionForm>
          ) : null}
          {todos.map((t) => (
            <div
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium">{t.title}</p>
                {eos.isConsolidated ? (
                  <p className="text-xs text-muted-foreground">
                    {entityDisplayName(t.entity_id)}
                  </p>
                ) : null}
              </div>
              <EosActionForm action={completeTodoAction}>
                <input type="hidden" name="todo_id" value={t.id} />
                <Button type="submit" size="sm" variant="outline">
                  Done
                </Button>
              </EosActionForm>
            </div>
          ))}
          {todos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open to-dos.</p>
          ) : null}
        </CardContent>
      </Card>

      {!eos.isConsolidated ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">V/TO</CardTitle>
            <CardDescription>
              Vision / Traction Organizer for{' '}
              {entityDisplayName(writeEntityId)}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EosActionForm
              action={saveVtoAction}
              className="grid gap-3 sm:grid-cols-2"
            >
              <input type="hidden" name="entity_id" value={writeEntityId} />
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Core values</span>
                <Textarea
                  name="core_values"
                  rows={3}
                  defaultValue={eos.vto?.core_values ?? ''}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Core focus</span>
                <Textarea
                  name="core_focus"
                  rows={3}
                  defaultValue={eos.vto?.core_focus ?? ''}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">10-year target</span>
                <Textarea
                  name="ten_year_target"
                  rows={3}
                  defaultValue={eos.vto?.ten_year_target ?? ''}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">3-year picture</span>
                <Textarea
                  name="three_year_picture"
                  rows={3}
                  defaultValue={eos.vto?.three_year_picture ?? ''}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">1-year plan</span>
                <Textarea
                  name="one_year_plan"
                  rows={3}
                  defaultValue={eos.vto?.one_year_plan ?? ''}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">
                  Marketing strategy
                </span>
                <Textarea
                  name="marketing_strategy"
                  rows={3}
                  defaultValue={eos.vto?.marketing_strategy ?? ''}
                />
              </label>
              <label className="space-y-1 text-sm sm:col-span-2">
                <span className="text-muted-foreground">Issues list notes</span>
                <Textarea
                  name="issues_list_notes"
                  rows={2}
                  defaultValue={eos.vto?.issues_list_notes ?? ''}
                />
              </label>
              <div className="sm:col-span-2">
                <Button type="submit" size="sm">
                  Save V/TO
                </Button>
              </div>
            </EosActionForm>
          </CardContent>
        </Card>
      ) : null}

      {eos.error ? (
        <p className="text-sm text-rose-700">{eos.error}</p>
      ) : null}
    </div>
  );
}
