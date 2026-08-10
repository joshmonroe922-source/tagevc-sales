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
      <div className="flex h-full min-h-0 flex-1 flex-col px-6 py-8 md:px-10">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Message Center
        </h1>
        <EmptyState
          title="Messaging is not ready yet"
          description={
            boot.error.includes('does not exist') ||
            boot.error.includes('os_conversation')
              ? 'Messaging setup is incomplete. Ask an admin to finish installation, then refresh.'
              : boot.error
          }
        />
      </div>
    );
  }

  return <MessagesShell initial={boot} />;
}
