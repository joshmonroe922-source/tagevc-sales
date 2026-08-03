import { requireCampaignAuth } from '@/lib/campaign/auth';
import { listCampaigns } from '@/lib/campaign/db/repo';
import { campaignDb } from '@/lib/campaign/db/client';
import Link from 'next/link';
import { ECC_ROUTE_PREFIX } from '@/lib/campaign/core/types';

export default async function TeamPage() {
  const auth = await requireCampaignAuth();
  if (!auth.permissions.viewTeam) {
    return (
      <p className="text-sm text-[#6b7280]">
        Team coaching view requires campaigns.view_team
      </p>
    );
  }
  const campaigns = await listCampaigns(auth.entityId);
  const sb = await campaignDb();
  const { data } = await sb
    .from('ecc_campaigns')
    .select('owner_id, stats_json')
    .eq('entity_id', auth.entityId)
    .limit(500);
  const byUser = new Map<string, { campaigns: number; sends: number }>();
  for (const c of data ?? []) {
    const key = c.owner_id || 'unassigned';
    const cur = byUser.get(key) || { campaigns: 0, sends: 0 };
    cur.campaigns += 1;
    cur.sends += Number((c.stats_json as { sent?: number })?.sent || 0);
    byUser.set(key, cur);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl font-semibold text-[#3a414f]">
          Team coaching
        </h2>
        <p className="text-sm text-[#5c6570]">
          Downline campaigns & metrics (read-only) · org chart from OS/Entra
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border border-[#e5e0d6] bg-white">
        <table className="w-full text-sm">
          <thead className="bg-[#f7f4ef] text-left text-[#6b7280]">
            <tr>
              <th className="px-4 py-2">Owner</th>
              <th className="px-4 py-2">Campaigns</th>
              <th className="px-4 py-2">Sends</th>
            </tr>
          </thead>
          <tbody>
            {[...byUser.entries()].map(([userId, m]) => (
              <tr key={userId} className="border-t border-[#eee9df]">
                <td className="px-4 py-2 font-mono text-xs">{userId}</td>
                <td className="px-4 py-2">{m.campaigns}</td>
                <td className="px-4 py-2">{m.sends}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section>
        <h3 className="mb-2 font-medium">Team campaigns</h3>
        <ul className="space-y-2 text-sm">
          {campaigns.slice(0, 30).map((c) => (
            <li key={c.id} className="flex justify-between">
              <Link
                href={`${ECC_ROUTE_PREFIX}/campaigns/${c.id}`}
                className="underline-offset-2 hover:underline"
              >
                {c.name}
              </Link>
              <span className="text-[#9ca3af]">{c.status}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
