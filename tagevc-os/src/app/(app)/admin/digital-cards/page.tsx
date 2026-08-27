import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/rbac/session';
import { insightsBySource, listTemplates } from '@/lib/digital-cards/repo';
import { entityDisplayName } from '@/lib/entities/display-name';
import { AdminDigitalCardsClient } from '@/components/digital-cards/admin-digital-cards-client';

export default async function AdminDigitalCardsPage() {
  const ctx = await getSessionContext();
  if (!ctx?.profile) redirect('/login');
  if (
    !['visionary', 'admin', 'coo', 'service_lead', 'partner', 'counsel_ops'].includes(
      ctx.profile.role,
    )
  ) {
    redirect('/home');
  }

  const templates = await listTemplates();
  const insights = await insightsBySource({ days: 30 });

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Admin
        </Link>
        <h1 className="mt-2 font-heading text-3xl font-semibold text-[#3B4559]">
          Digital cards
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Entity templates, provision/revoke, and lightweight insights by
          source channel. NFC: blank NTAG URL = tagged public link (copy from
          My Card).
        </p>
      </div>

      <AdminDigitalCardsClient templates={templates} />

      <section>
        <h2 className="font-heading text-lg font-semibold text-[#3B4559]">
          Insights · last 30 days
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Views, saves, exchanges by entity and source — useful, not noisy.
        </p>
        {insights.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No events yet.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-[#e0dcd2] bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e8e4dc] text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Entity</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Count</th>
                </tr>
              </thead>
              <tbody>
                {insights
                  .sort((a, b) => b.count - a.count)
                  .slice(0, 40)
                  .map((row) => (
                    <tr
                      key={`${row.entity_id}-${row.source_channel}-${row.event_type}`}
                      className="border-b border-[#f0ece4]"
                    >
                      <td className="px-3 py-2">
                        {entityDisplayName(row.entity_id)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {row.source_channel}
                      </td>
                      <td className="px-3 py-2">{row.event_type}</td>
                      <td className="px-3 py-2 font-medium">{row.count}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </div>
  );
}
