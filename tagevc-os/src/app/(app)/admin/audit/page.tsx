import Link from 'next/link';
import { AuditLogClient } from '@/components/admin/audit-log-client';
import { listAuditEvents } from '@/lib/audit/write';
import { getSessionContext } from '@/lib/rbac/session';
import { redirect } from 'next/navigation';

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionContext();
  if (!session || session.realRole !== 'visionary') {
    redirect('/home');
  }

  const sp = (await searchParams) ?? {};
  const actorEmail = typeof sp.user === 'string' ? sp.user : '';
  const entityId = typeof sp.entity === 'string' ? sp.entity : '';
  const action = typeof sp.action === 'string' ? sp.action : '';
  const from = typeof sp.from === 'string' ? sp.from : '';
  const to = typeof sp.to === 'string' ? sp.to : '';

  const result = await listAuditEvents({
    actorEmail: actorEmail || null,
    entityId: entityId || null,
    action: action || null,
    from: from || null,
    to: to || null,
    limit: 200,
  });

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
          Visionary Audit log
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Visionary-only append-only record of meaningful OS activity. IT
          operators use the operational Activity log under Technology / IT —
          not this surface. Coverage expands via the central audit writer.
        </p>
      </header>

      <AuditLogClient
        events={result.events}
        error={result.error}
        initialFilters={{
          user: actorEmail,
          entity: entityId,
          action,
          from,
          to,
        }}
      />
    </div>
  );
}
