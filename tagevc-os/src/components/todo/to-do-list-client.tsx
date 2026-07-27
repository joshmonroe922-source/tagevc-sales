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
import type { OperatorTodoItem, OperatorTodoList } from '@/lib/todo/operator-todo-list';
import { cn } from '@/lib/utils';

function dueBadge(item: OperatorTodoItem) {
  if (item.is_overdue) {
    return (
      <Badge variant="outline" className="border-red-300 text-red-800">
        Overdue
      </Badge>
    );
  }
  if (item.due_date) {
    return <Badge variant="secondary">Due {item.due_date.slice(0, 10)}</Badge>;
  }
  return null;
}

function TodoSection({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: OperatorTodoItem[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <EmptyState
            title="Nothing in this lane"
            description="Open items will appear here when they need attention."
            className="py-8"
          />
        ) : (
          items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className={cn(
                'flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/40',
              )}
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">
                  {item.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.source_label}
                  {item.subtitle ? ` · ${item.subtitle}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {item.status ? (
                  <Badge variant="outline">{item.status}</Badge>
                ) : null}
                {dueBadge(item)}
              </div>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function ToDoListClient({ list }: { list: OperatorTodoList }) {
  const ssc = list.items.filter((i) => i.source === 'ssc_checklist');
  const followups = list.items.filter((i) => i.source.endsWith('_followup'));
  const pipeline = list.items.filter(
    (i) => i.source !== 'ssc_checklist' && !i.source.endsWith('_followup'),
  );

  if (list.counts.total === 0) {
    return (
      <EmptyState
        title="You're clear"
        description="No Shared Services checklist tasks, pipeline tasks, or follow-ups in your scope. Help Desk tickets live under Create Ticket → Help Desk."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {list.counts.total} open · {list.counts.ssc} SSC ·{' '}
        {list.counts.pipeline} pipeline tasks · {list.counts.followups}{' '}
        follow-ups — not Help Desk tickets.
      </p>
      <TodoSection
        title="Shared Services checklists"
        description="Open SSC period tasks that need attention."
        items={ssc}
      />
      <TodoSection
        title="Lead · deal · service tasks"
        description="Open VC / M&A / RE process tasks in your scope."
        items={pipeline}
      />
      <TodoSection
        title="Follow-ups"
        description="Next-action reminders on leads, deals, and targets."
        items={followups}
      />
    </div>
  );
}
