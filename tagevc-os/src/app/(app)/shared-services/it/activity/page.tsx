import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ItActivityLogClient } from '@/components/shared-services/it-activity-log-client';
import { listItActivity } from '@/lib/shared-services/it-activity';
import { getSessionContext } from '@/lib/rbac/session';
import { roleHasPermission } from '@/lib/types/roles';

export default async function ItActivityLogPage() {
  const session = await getSessionContext();
  if (
    !session ||
    !roleHasPermission(session.profile.role, 'read:it_assets')
  ) {
    redirect('/home');
  }

  // Visionary-only full audit stays at /admin/audit — never expose here.
  const result = await listItActivity(150);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link
            href="/shared-services/it/assets"
            className="text-muted-foreground hover:text-foreground"
          >
            ← Technology / IT
          </Link>
        </div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Activity log
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Operational IT activity — onboarding, offboarding, renewals, and
          Intune-related firm actions. The Visionary Audit log (full OS trail)
          remains Visionary-only.
        </p>
      </header>

      <ItActivityLogClient
        events={result.events}
        error={result.ok ? null : result.error}
      />
    </div>
  );
}
