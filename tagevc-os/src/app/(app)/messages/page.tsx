import { getMessagingBootstrapAction } from '@/app/(app)/messages/actions';
import { MessagesShell } from '@/components/messaging/messages-shell';
import { EmptyState } from '@/components/ui/empty-state';

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const params = await searchParams;
  const boot = await getMessagingBootstrapAction(params.c ?? null);

  if (!boot.ok) {
    return (
      <div className="space-y-4">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Messages
        </h1>
        <EmptyState
          title="Messaging is not ready"
          description={
            boot.error.includes('does not exist') ||
            boot.error.includes('os_conversation')
              ? 'Apply supabase/phase10_messaging.sql in the Supabase SQL editor, then refresh.'
              : boot.error
          }
        />
      </div>
    );
  }

  return <MessagesShell initial={boot} />;
}
