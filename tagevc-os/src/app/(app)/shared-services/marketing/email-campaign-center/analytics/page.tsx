import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import { campaignDb } from '@/lib/campaign/db/client';

export default async function Page() {
  await requirePermission('read:marketing');
  const ctx = await getSessionContext();
  const entityId = ctx?.profile.entity_id || 'ENT-FIRM';
  const sb = await campaignDb();
  const [campaigns, events] = await Promise.all([
    sb.from('ecc_campaigns').select('id', { count: 'exact', head: true }).eq('entity_id', entityId),
    sb.from('ecc_engagement_events').select('event_type', { count: 'exact', head: true }).eq('entity_id', entityId),
  ]);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-xl font-semibold text-[#3a414f]">Analytics</h2>
        <p className="text-sm text-muted-foreground">Entity funnel metrics and team coaching views.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-[#d7d3c3] bg-white px-4 py-3">
          <p className="text-xs uppercase text-muted-foreground">Campaigns</p>
          <p className="font-heading mt-1 text-2xl text-[#3a414f]">{campaigns.count ?? 0}</p>
        </div>
        <div className="rounded-lg border border-[#d7d3c3] bg-white px-4 py-3">
          <p className="text-xs uppercase text-muted-foreground">Engagement events</p>
          <p className="font-heading mt-1 text-2xl text-[#3a414f]">{events.count ?? 0}</p>
        </div>
      </div>
    </div>
  );
}
