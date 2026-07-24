'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { entityDisplayName } from '@/lib/entities/display-name';
import {
  completionLabel,
  statusLabel,
  type HrisProcessRun,
} from '@/lib/hris/types';

export function HrisRunsQueueClient({
  kind,
  runs,
  error,
}: {
  kind: 'onboarding' | 'offboarding';
  runs: Array<HrisProcessRun & { employee_name?: string; entity_id?: string }>;
  error?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base capitalize">{kind} queue</CardTitle>
        <CardDescription>
          {kind === 'offboarding'
            ? 'Revoke-first access sequence. Destructive steps need human confirmation on the employee record.'
            : 'Open onboarding runs across companies.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {runs.length === 0 ? (
          <EmptyState
            title={`No open ${kind} runs`}
            description="Create an employee or start a run from their record."
          />
        ) : (
          runs.map((r) => (
            <Link
              key={r.id}
              href={`/shared-services/hr/employees/${r.employee_id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/40"
            >
              <div>
                <p className="font-medium">
                  {r.employee_name ?? 'Employee'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {r.entity_id
                    ? entityDisplayName(r.entity_id)
                    : 'Company'}{' '}
                  · {completionLabel(r.completion_pct)}
                </p>
              </div>
              <Badge variant="secondary">{statusLabel(r.status)}</Badge>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}
