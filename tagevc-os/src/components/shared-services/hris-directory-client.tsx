'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  createHrisEmployeeAction,
  runHrisCadenceAction,
} from '@/app/(app)/shared-services/hr/actions-hris';
import { CompanySelect } from '@/components/shared/company-select';
import { PeoplePicker } from '@/components/shared-services/people-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { entityDisplayName } from '@/lib/entities/display-name';
import {
  completionLabel,
  statusLabel,
  type HrisEmployee,
} from '@/lib/hris/types';

export function HrisDirectoryClient({
  employees,
  canWrite,
  error,
}: {
  employees: HrisEmployee[];
  canWrite: boolean;
  error?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [entityFilter, setEntityFilter] = useState('');

  const filtered = employees.filter((e) => {
    if (statusFilter !== 'all' && e.status !== statusFilter) return false;
    if (entityFilter && e.entity_id !== entityFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Status</span>
            <select
              className="block h-9 rounded-md border border-border bg-background px-2 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All</option>
              <option value="pre_start">Pre-start</option>
              <option value="onboarding">Onboarding</option>
              <option value="active">Active</option>
              <option value="leave">Leave</option>
              <option value="offboarding">Offboarding</option>
              <option value="terminated">Terminated</option>
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Company</span>
            <CompanySelect
              allowAll
              allLabel="All companies"
              value={entityFilter}
              onChange={setEntityFilter}
              className="block min-w-[12rem]"
            />
          </label>
        </div>
        {canWrite ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await runHrisCadenceAction('full');
                setMessage(res.ok ? res.message : res.error);
                router.refresh();
              })
            }
          >
            Run timing / escalate
          </Button>
        ) : null}
      </div>

      {message ? (
        <p className="text-xs text-muted-foreground">{message}</p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Employees</CardTitle>
          <CardDescription>
            System of record across Tage and subsidiaries — company names, not
            entity codes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <EmptyState
              title="No employees match"
              description="Create a hire below or clear filters."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Onboarding</TableHead>
                  <TableHead>Start</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <Link
                        href={`/shared-services/hr/employees/${e.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {e.full_name}
                      </Link>
                    </TableCell>
                    <TableCell>{entityDisplayName(e.entity_id)}</TableCell>
                    <TableCell>{e.role_title || '—'}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{statusLabel(e.status)}</Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {completionLabel(e.onboarding_pct)}
                      {e.onboarding_status !== 'none' ? (
                        <span className="ml-1 text-xs text-muted-foreground">
                          · {statusLabel(e.onboarding_status)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>{e.start_date ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create employee</CardTitle>
            <CardDescription>
              Auto-starts an onboarding run from the company template.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 sm:grid-cols-2"
              action={(fd) =>
                start(async () => {
                  const res = await createHrisEmployeeAction(fd);
                  setMessage(res.ok ? res.message : res.error);
                  if (res.ok && res.id) {
                    router.push(`/shared-services/hr/employees/${res.id}`);
                  } else {
                    router.refresh();
                  }
                })
              }
            >
              <div className="space-y-1.5">
                <Label htmlFor="full_name">Full name *</Label>
                <Input id="full_name" name="full_name" required minLength={2} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role_title">Title *</Label>
                <Input id="role_title" name="role_title" required minLength={2} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="entity_id">Company *</Label>
                <CompanySelect
                  id="entity_id"
                  name="entity_id"
                  required
                  defaultValue="ENT-R619"
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="work_email">Work email</Label>
                <Input id="work_email" name="work_email" type="email" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="start_date">Start date</Label>
                <Input id="start_date" name="start_date" type="date" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <PeoplePicker
                  name="manager_profile_id"
                  label="Reports to *"
                />
                <p className="text-[11px] text-muted-foreground">
                  Required for org chart + JML. Opens hire cost model under{' '}
                  <a href="/admin/hire-impact?from=hire" className="underline">
                    Admin → Hire impact
                  </a>
                  .
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="department">Department</Label>
                <Input id="department" name="department" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="location">Location</Label>
                <Input id="location" name="location" />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={pending}>
                  {pending ? 'Creating…' : 'Create & start onboarding'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
