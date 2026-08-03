import Link from 'next/link';
import { listCampaigns } from '@/lib/campaign/db/repo';
import { ECC_ROUTE_PREFIX } from '@/lib/campaign/core/types';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';

export default async function Page() {
  await requirePermission('read:marketing');
  const ctx = await getSessionContext();
  const campaigns = await listCampaigns(ctx?.profile.entity_id || 'ENT-FIRM');
  return (
    <div className="space-y-4">
      <div className="flex justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-semibold text-[#3a414f]">Campaigns</h2>
          <p className="text-sm text-muted-foreground">Blasts with approval · controlled Graph send + tracking</p>
        </div>
        <Link href={`${ECC_ROUTE_PREFIX}/campaigns/new`} className="inline-flex h-8 items-center rounded-lg bg-[#3a414f] px-3 text-sm text-[#ece9e6]">New campaign</Link>
      </div>
      <div className="overflow-hidden rounded-lg border border-[#d7d3c3] bg-white">
        <table className="w-full text-sm">
          <thead className="bg-[#ece9e6]/70 text-xs text-muted-foreground"><tr>
            <th className="px-4 py-2 text-left">Name</th><th className="px-4 py-2 text-left">Status</th><th className="px-4 py-2 text-left">Plane</th>
          </tr></thead>
          <tbody>
            {campaigns.length === 0 ? (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No campaigns yet</td></tr>
            ) : campaigns.map((c: any) => (
              <tr key={c.id} className="border-t border-[#ece9e6]">
                <td className="px-4 py-2"><Link className="font-medium text-[#3a414f] hover:underline" href={`${ECC_ROUTE_PREFIX}/campaigns/${c.id}`}>{c.name}</Link></td>
                <td className="px-4 py-2 text-xs">{c.status}</td>
                <td className="px-4 py-2 text-xs">{c.delivery_plane}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
