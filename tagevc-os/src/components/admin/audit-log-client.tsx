'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { entityDisplayName } from '@/lib/entities/display-name';

type EventRow = {
  audit_id?: string;
  event_key?: string;
  actor_email?: string | null;
  actor_name?: string | null;
  actor_role?: string | null;
  real_role?: string | null;
  entity_id?: string | null;
  action?: string;
  object_type?: string | null;
  object_id?: string | null;
  title?: string;
  created_at?: string;
};

export function AuditLogClient({
  events,
  error,
  initialFilters,
}: {
  events: EventRow[];
  error: string | null;
  initialFilters: {
    user: string;
    entity: string;
    action: string;
    from: string;
    to: string;
  };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function apply(form: HTMLFormElement) {
    const fd = new FormData(form);
    const next = new URLSearchParams();
    for (const key of ['user', 'entity', 'action', 'from', 'to'] as const) {
      const v = String(fd.get(key) ?? '').trim();
      if (v) next.set(key, v);
    }
    start(() => {
      router.replace(`/admin/audit?${next.toString()}`);
    });
  }

  return (
    <div className="space-y-4">
      <form
        className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-2 lg:grid-cols-6"
        onSubmit={(e) => {
          e.preventDefault();
          apply(e.currentTarget);
        }}
      >
        <Input
          name="user"
          defaultValue={initialFilters.user}
          placeholder="User email"
          className="h-8 text-xs"
        />
        <Input
          name="entity"
          defaultValue={initialFilters.entity}
          placeholder="Company ENT-*"
          className="h-8 text-xs"
        />
        <Input
          name="action"
          defaultValue={initialFilters.action}
          placeholder="Action type"
          className="h-8 text-xs"
        />
        <Input
          name="from"
          type="date"
          defaultValue={initialFilters.from.slice(0, 10)}
          className="h-8 text-xs"
        />
        <Input
          name="to"
          type="date"
          defaultValue={initialFilters.to.slice(0, 10)}
          className="h-8 text-xs"
        />
        <Button type="submit" size="sm" disabled={pending}>
          Filter
        </Button>
      </form>

      {error ? (
        <p className="text-sm text-muted-foreground">
          {error.includes('os_audit_events')
            ? 'Audit table unavailable — apply phase71 SQL.'
            : error}
        </p>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Object</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground">
                No audit events yet.
              </TableCell>
            </TableRow>
          ) : (
            events.map((e) => (
              <TableRow key={e.audit_id ?? e.event_key}>
                <TableCell className="whitespace-nowrap text-xs tabular-nums">
                  {e.created_at
                    ? new Date(e.created_at).toLocaleString()
                    : '—'}
                </TableCell>
                <TableCell className="text-xs">
                  <div>{e.actor_name || e.actor_email || '—'}</div>
                  <div className="text-muted-foreground">
                    {e.actor_role}
                    {e.real_role && e.real_role !== e.actor_role
                      ? ` (real ${e.real_role})`
                      : ''}
                  </div>
                </TableCell>
                <TableCell className="text-xs">
                  {e.entity_id ? entityDisplayName(e.entity_id) : '—'}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {e.action}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{e.title}</TableCell>
                <TableCell className="font-mono text-[10px] text-muted-foreground">
                  {e.object_type || '—'}
                  {e.object_id ? `/${e.object_id}` : ''}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
