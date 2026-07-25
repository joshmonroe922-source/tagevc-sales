'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { updateHrisStepAction } from '@/app/(app)/shared-services/hr/actions-hris';
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
import { entityDisplayName } from '@/lib/entities/display-name';
import { isStepOverdue } from '@/lib/hris/timing';
import type { ManagerEmployeeBundle } from '@/lib/hris/manager-view';
import { statusLabel, type HrisStepStatus } from '@/lib/hris/types';

export function HrisManagerClient({
  bundles,
}: {
  bundles: ManagerEmployeeBundle[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const complete = (
    employeeId: string,
    stepId: string,
    status: HrisStepStatus,
  ) => {
    start(async () => {
      const res = await updateHrisStepAction({
        stepId,
        employeeId,
        status,
        evidenceNote: notes[stepId]?.trim() || undefined,
        managerMode: true,
      });
      setMessage(res.ok ? res.message : res.error);
      router.refresh();
    });
  };

  if (bundles.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No assigned employees. HR can set Manager profile id on the employee
        record to enable this view.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {message ? (
        <p className="text-xs text-muted-foreground">{message}</p>
      ) : null}
      {bundles.map((b) => (
        <Card key={b.employee.id}>
          <CardHeader>
            <CardTitle className="text-base">
              <Link
                href={`/shared-services/hr/employees/${b.employee.id}`}
                className="underline-offset-4 hover:underline"
              >
                {b.employee.full_name}
              </Link>
            </CardTitle>
            <CardDescription>
              {entityDisplayName(b.employee.entity_id)} ·{' '}
              {b.employee.role_title || '—'} · manager-owned steps only
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {b.runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No open onboarding/offboarding runs.
              </p>
            ) : (
              b.runs.map((run) => (
                <div key={run.id} className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {run.kind} · {statusLabel(run.status)}
                  </p>
                  {run.manager_steps.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No manager-owned steps on this run.
                    </p>
                  ) : (
                    run.manager_steps.map((step) => {
                      const overdue = isStepOverdue(step);
                      const closed = ['done', 'waived', 'na'].includes(
                        step.status,
                      );
                      return (
                        <div
                          key={step.id}
                          className="rounded-md border border-border px-3 py-2 text-sm"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-medium">{step.title}</p>
                              <p className="text-xs text-muted-foreground">
                                {step.category}
                                {step.due_at ? ` · due ${step.due_at}` : ''}
                              </p>
                            </div>
                            <div className="flex gap-1">
                              {overdue ? (
                                <Badge variant="destructive">Overdue</Badge>
                              ) : null}
                              <Badge variant="outline">
                                {statusLabel(step.status)}
                              </Badge>
                            </div>
                          </div>
                          {!closed ? (
                            <div className="mt-2 space-y-2">
                              <Input
                                placeholder="Notes / evidence"
                                value={notes[step.id] ?? ''}
                                onChange={(e) =>
                                  setNotes((prev) => ({
                                    ...prev,
                                    [step.id]: e.target.value,
                                  }))
                                }
                              />
                              <div className="flex flex-wrap gap-1">
                                <Button
                                  size="sm"
                                  disabled={pending}
                                  onClick={() =>
                                    complete(b.employee.id, step.id, 'done')
                                  }
                                >
                                  Complete
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={pending}
                                  onClick={() =>
                                    complete(b.employee.id, step.id, 'blocked')
                                  }
                                >
                                  Block
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
