import { PageHeader } from '@/components/ui/page-header';
import { ToDoListClient } from '@/components/todo/to-do-list-client';
import { loadOperatorTodoList } from '@/lib/todo/operator-todo-list';
import { getSessionContext } from '@/lib/rbac/session';

export const dynamic = 'force-dynamic';

export default async function ToDoListPage() {
  const session = await getSessionContext();
  if (!session) return null;

  const list = await loadOperatorTodoList(session);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operator"
        title="To Do List"
        description="Shared Services checklist work, lead/deal follow-ups, and other operator tasks in your scope. Help Desk tickets stay under Create Ticket → Help Desk."
      />
      <ToDoListClient list={list} />
    </div>
  );
}
