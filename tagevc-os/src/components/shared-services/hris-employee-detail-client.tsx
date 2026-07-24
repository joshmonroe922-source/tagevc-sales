'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  startHrisOffboardingAction,
  startHrisOnboardingAction,
  updateHrisEmployeeAction,
  updateHrisStepAction,
} from '@/app/(app)/shared-services/hr/actions-hris';
import { CompanySelect } from '@/components/shared/company-select';
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
import { entityDisplayName } from '@/lib/entities/display-name';
import { recruitPeopleHref } from '@/lib/hris/recruit-hook';
import { isStepOverdue } from '@/lib/hris/timing';
import {
  completionLabel,
  statusLabel,
  type HrisEmployee,
  type HrisEmployeeEvent,
  type HrisEmployeeLink,
  type HrisProcessRun,
  type HrisStepStatus,
} from '@/lib/hris/types';

export function HrisEmployeeDetailClient({
  employee,
  runs,
  events,
  links,
  canWrite,
}: {
  employee: HrisEmployee;
  runs: HrisProcessRun[];
  events: HrisEmployeeEvent[];
  links: HrisEmployeeLink[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const onboarding = runs.find((r) => r.kind === 'onboarding');
  const offboarding = runs.find((r) => r.kind === 'offboarding');
  const recruitHref = recruitPeopleHref(employee.recruit_assignment);

  const setStep = (
    stepId: string,
    status: HrisStepStatus,
    destructive?: boolean,
  ) => {
    start(async () => {
      const res = await updateHrisStepAction({
        stepId,
        employeeId: employee.id,
        status,
        confirmDestructive: destructive,
      });
      setMessage(res.ok ? res.message : res.error);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {message ? (
        <p className="text-xs text-muted-foreground">{message}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{statusLabel(employee.status)}</Badge>
        <Badge variant="outline">
          {entityDisplayName(employee.entity_id)}
        </Badge>
        <Badge variant="outline">
          Onboarding {completionLabel(employee.onboarding_pct)}
        </Badge>
        {employee.offboarding_status !== 'none' ? (
          <Badge variant="outline">
            Offboarding {completionLabel(employee.offboarding_pct)}
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile</CardTitle>
            <CardDescription>
              Employee system of record — not just tickets or checklists.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {canWrite ? (
              <form
                className="grid gap-3 sm:grid-cols-2"
                action={(fd) =>
                  start(async () => {
                    const res = await updateHrisEmployeeAction(employee.id, fd);
                    setMessage(res.ok ? res.message : res.error);
                    router.refresh();
                  })
                }
              >
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="full_name">Name</Label>
                  <Input
                    id="full_name"
                    name="full_name"
                    defaultValue={employee.full_name}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="role_title">Title</Label>
                  <Input
                    id="role_title"
                    name="role_title"
                    defaultValue={employee.role_title}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="entity_id">Company</Label>
                  <CompanySelect
                    id="entity_id"
                    name="entity_id"
                    defaultValue={employee.entity_id}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="work_email">Work email</Label>
                  <Input
                    id="work_email"
                    name="work_email"
                    defaultValue={employee.work_email}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="personal_email">Personal email</Label>
                  <Input
                    id="personal_email"
                    name="personal_email"
                    defaultValue={employee.personal_email}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    name="phone"
                    defaultValue={employee.phone}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="manager_name">Manager</Label>
                  <Input
                    id="manager_name"
                    name="manager_name"
                    defaultValue={employee.manager_name}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="department">Department</Label>
                  <Input
                    id="department"
                    name="department"
                    defaultValue={employee.department}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="location">Location</Label>
                  <Input
                    id="location"
                    name="location"
                    defaultValue={employee.location}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="start_date">Start date</Label>
                  <Input
                    id="start_date"
                    name="start_date"
                    type="date"
                    defaultValue={employee.start_date ?? ''}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="end_date">End date</Label>
                  <Input
                    id="end_date"
                    name="end_date"
                    type="date"
                    defaultValue={employee.end_date ?? ''}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="status">Status</Label>
                  <select
                    id="status"
                    name="status"
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    defaultValue={employee.status}
                  >
                    {[
                      'pre_start',
                      'onboarding',
                      'active',
                      'leave',
                      'offboarding',
                      'terminated',
                    ].map((s) => (
                      <option key={s} value={s}>
                        {statusLabel(s)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Input id="notes" name="notes" defaultValue={employee.notes} />
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={pending} size="sm">
                    Save profile
                  </Button>
                </div>
              </form>
            ) : (
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">Title</dt>
                  <dd>{employee.role_title || '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Email</dt>
                  <dd>{employee.work_email || '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Manager</dt>
                  <dd>{employee.manager_name || '—'}</dd>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Links & Recruit</CardTitle>
            <CardDescription>
              Documents, equipment, access, and Recruit 619 assignment stub.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {recruitHref ? (
              <p>
                Recruit assignment:{' '}
                <a
                  href={recruitHref}
                  className="underline-offset-4 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {employee.recruit_assignment.status ?? 'pending_link'}
                </a>
              </p>
            ) : (
              <p className="text-muted-foreground">
                No Recruit assignment (company is not Recruit 619).
              </p>
            )}
            {links.length === 0 ? (
              <p className="text-muted-foreground">
                No document / equipment / access links yet. Link IT runs from IT
                Assets when available.
              </p>
            ) : (
              <ul className="space-y-1">
                {links.map((l) => (
                  <li key={l.id}>
                    {l.href ? (
                      <Link
                        href={l.href}
                        className="underline-offset-4 hover:underline"
                      >
                        {l.label}
                      </Link>
                    ) : (
                      l.label
                    )}{' '}
                    <span className="text-xs text-muted-foreground">
                      · {l.kind}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {canWrite ? (
              <div className="flex flex-wrap gap-2 pt-2">
                {!onboarding ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const res = await startHrisOnboardingAction(employee.id);
                        setMessage(res.ok ? res.message : res.error);
                        router.refresh();
                      })
                    }
                  >
                    Start onboarding
                  </Button>
                ) : null}
                {!offboarding ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={pending}
                    onClick={() => {
                      if (
                        !window.confirm(
                          'Start offboarding? Access revoke steps require separate human confirmation.',
                        )
                      ) {
                        return;
                      }
                      start(async () => {
                        const res = await startHrisOffboardingAction(
                          employee.id,
                        );
                        setMessage(res.ok ? res.message : res.error);
                        router.refresh();
                      });
                    }}
                  >
                    Start offboarding
                  </Button>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {(onboarding || offboarding) &&
        [onboarding, offboarding].filter(Boolean).map((run) => (
          <Card key={run!.id}>
            <CardHeader>
              <CardTitle className="text-base capitalize">
                {run!.kind} · {completionLabel(run!.completion_pct)}
              </CardTitle>
              <CardDescription>
                Status {statusLabel(run!.status)}
                {run!.kind === 'offboarding'
                  ? ' · revoke-first sequence; destructive steps need confirm'
                  : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {(run!.steps ?? []).map((step) => {
                const overdue = isStepOverdue(step);
                return (
                  <div
                    key={step.id}
                    className="rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{step.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {step.category} · {step.owner_role}
                          {step.due_at ? ` · due ${step.due_at}` : ''}
                          {step.optional_for_audience ? ' · optional' : ''}
                          {step.destructive ? ' · destructive' : ''}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {overdue ? (
                          <Badge variant="destructive">Overdue</Badge>
                        ) : null}
                        <Badge variant="outline">
                          {statusLabel(step.status)}
                        </Badge>
                      </div>
                    </div>
                    {canWrite &&
                    !['done', 'waived', 'na'].includes(step.status) ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={pending}
                          onClick={() => {
                            if (step.destructive) {
                              if (
                                !window.confirm(
                                  `Confirm destructive step: ${step.title}?`,
                                )
                              ) {
                                return;
                              }
                              setStep(step.id, 'done', true);
                            } else {
                              setStep(step.id, 'done');
                            }
                          }}
                        >
                          Complete
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => setStep(step.id, 'waived')}
                        >
                          Waive / N/A
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => setStep(step.id, 'blocked')}
                        >
                          Block
                        </Button>
                      </div>
                    ) : null}
                    {step.escalated_ticket_id ? (
                      <p className="mt-1 text-xs">
                        Escalated:{' '}
                        <Link
                          href={`/shared-services/tickets/${step.escalated_ticket_id}`}
                          className="underline-offset-4 hover:underline"
                        >
                          Open ticket
                        </Link>
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {events.length === 0 ? (
            <p className="text-muted-foreground">No events yet.</p>
          ) : (
            events.map((ev) => (
              <div
                key={ev.id}
                className="flex flex-wrap justify-between gap-2 border-b border-border/60 py-1.5"
              >
                <span>{ev.summary}</span>
                <span className="text-xs text-muted-foreground">
                  {ev.created_at.slice(0, 16).replace('T', ' ')}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
