'use client';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { entityDisplayName } from '@/lib/entities/display-name';

type ActivityRow = {
  id?: string;
  event_id?: string;
  module?: string;
  action?: string;
  title?: string;
  detail?: string | null;
  entity_id?: string | null;
  actor_email?: string | null;
  actor_name?: string | null;
  created_at?: string;
};

export function ItActivityLogClient({
  events,
  error,
}: {
  events: ActivityRow[];
  error: string | null;
}) {
  return (
    <div className="space-y-4">
      {error ? (
        <p className="text-sm text-muted-foreground">{error}</p>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Title</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground">
                No IT operational activity yet.
              </TableCell>
            </TableRow>
          ) : (
            events.map((e) => (
              <TableRow key={e.id ?? e.event_id}>
                <TableCell className="whitespace-nowrap text-xs tabular-nums">
                  {e.created_at
                    ? new Date(e.created_at).toLocaleString()
                    : '—'}
                </TableCell>
                <TableCell className="text-xs">
                  <div>{e.actor_name || e.actor_email || '—'}</div>
                  {e.actor_email && e.actor_name ? (
                    <div className="text-muted-foreground">{e.actor_email}</div>
                  ) : null}
                </TableCell>
                <TableCell className="text-xs">
                  {e.entity_id ? entityDisplayName(e.entity_id) : '—'}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {e.action}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">
                  <div>{e.title}</div>
                  {e.detail ? (
                    <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                      {e.detail}
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
