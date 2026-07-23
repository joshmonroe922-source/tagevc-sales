import Link from 'next/link';

import { ThinkTankClient } from '@/components/think-tank/ThinkTankClient';
import { loadThinkTank } from '@/app/(app)/think-tank/actions';
import { getSessionContext } from '@/lib/rbac/session';

export default async function ThinkTankPage() {
  const session = await getSessionContext();
  if (!session) return null;

  const data = await loadThinkTank();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
            Profile · Think Tank
          </p>
          <h1 className="font-heading mt-2 text-3xl text-foreground">
            {session.profile.full_name || session.profile.email}
          </h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Role-aware Grok advisor grounded in your Tage VC operating desk.
            Thread persists so you can return throughout the day.
          </p>
        </div>
        <Link
          href="/command-center"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Back to Command Center
        </Link>
      </div>

      <ThinkTankClient
        initialMessages={data.messages}
        roleBand={data.roleBand}
        viewAsLabel={data.viewAsLabel}
      />
    </div>
  );
}
