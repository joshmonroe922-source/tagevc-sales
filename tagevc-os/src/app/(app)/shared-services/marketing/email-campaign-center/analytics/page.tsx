import Link from 'next/link';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import { analyticsOverview } from '@/lib/campaign/db/repo';
import { ECC_ROUTE_PREFIX } from '@/lib/campaign/core/types';

export default async function Page() {
  await requirePermission('read:marketing');
  const ctx = await getSessionContext();
  const entityId = ctx?.profile.entity_id || 'ENT-FIRM';
  const overview = await analyticsOverview(entityId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-semibold text-[#3a414f]">Analytics</h2>
          <p className="text-sm text-[#7c7871]">Entity funnel metrics — deep engagement on Intelligence.</p>
        </div>
        <Link
          href={`${ECC_ROUTE_PREFIX}/intelligence`}
          className="rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white"
        >
          Open intelligence
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Campaigns', value: overview.campaigns },
          { label: 'Journeys', value: overview.journeys },
          { label: 'Engagement events', value: overview.engagement_events },
          { label: 'Avg score', value: overview.avg_engagement_score },
        ].map((x) => (
          <div key={x.label} className="rounded-xl border border-[#d7d3c3] bg-white px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-[#7c7871]">{x.label}</p>
            <p className="font-heading mt-1 text-2xl text-[#3a414f]">{x.value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-[#d7d3c3] bg-white px-4 py-3">
          <p className="text-xs text-[#7c7871]">Hot recipients (score ≥ 4)</p>
          <p className="font-heading mt-1 text-xl text-[#3a414f]">{overview.hot_recipients}</p>
        </div>
        <div className="rounded-xl border border-[#d7d3c3] bg-white px-4 py-3">
          <p className="text-xs text-[#7c7871]">Clicked, no reply</p>
          <p className="font-heading mt-1 text-xl text-[#3a414f]">{overview.clicked_no_reply}</p>
        </div>
      </div>
      {Object.keys(overview.events_by_type).length ? (
        <div className="rounded-xl border border-[#d7d3c3] bg-white p-4">
          <h3 className="font-heading text-sm text-[#3a414f]">Events by type</h3>
          <ul className="mt-2 grid gap-1 sm:grid-cols-3 text-sm">
            {Object.entries(overview.events_by_type).map(([k, v]) => (
              <li key={k} className="flex justify-between border-b border-[#f0ebe3] py-1">
                <span className="text-[#5c6570]">{k}</span>
                <span className="font-medium text-[#3a414f]">{v}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
