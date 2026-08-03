import Link from 'next/link';
import { ECC_ROUTE_PREFIX } from '@/lib/campaign/core/types';

type Home = {
  hotFollowUps: Array<{
    id: string;
    email: string;
    engagement_score: number;
    click_count: number;
    campaign_id: string;
  }>;
  needsApproval: Array<{ id: string; name: string; status: string }>;
  myCampaigns: Array<{ id: string; name: string; status: string }>;
  deliverabilityAlerts: Array<{ domain: string; status: string }>;
  flags?: { campaign_enabled?: boolean; kill_switch?: boolean } | null;
};

export function EccToday({ home }: { home: Home }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Widget title="Hot follow-ups" cta={{ href: `${ECC_ROUTE_PREFIX}/analytics`, label: 'Open queue' }}>
        {(home.hotFollowUps || []).length === 0 ? (
          <Empty>No clicked-no-reply contacts yet</Empty>
        ) : (
          <ul className="space-y-2">
            {home.hotFollowUps.slice(0, 6).map((r) => (
              <li key={r.id} className="flex justify-between text-sm">
                <span className="truncate">{r.email}</span>
                <span className="text-[#9ca3af]">score {r.engagement_score}</span>
              </li>
            ))}
          </ul>
        )}
      </Widget>

      <Widget title="Needs approval" cta={{ href: `${ECC_ROUTE_PREFIX}/campaigns`, label: 'Review' }}>
        {(home.needsApproval || []).length === 0 ? (
          <Empty>Inbox clear</Empty>
        ) : (
          <ul className="space-y-2">
            {home.needsApproval.map((c) => (
              <li key={c.id}>
                <Link
                  href={`${ECC_ROUTE_PREFIX}/campaigns/${c.id}`}
                  className="text-sm underline-offset-2 hover:underline"
                >
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Widget>

      <Widget title="My campaigns" cta={{ href: `${ECC_ROUTE_PREFIX}/campaigns/new`, label: 'Create' }}>
        {(home.myCampaigns || []).length === 0 ? (
          <Empty>Create your first blast</Empty>
        ) : (
          <ul className="space-y-2">
            {home.myCampaigns.map((c) => (
              <li key={c.id} className="flex justify-between text-sm">
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
        )}
      </Widget>

      <Widget title="Deliverability" cta={{ href: `${ECC_ROUTE_PREFIX}/deliverability`, label: 'Cockpit' }}>
        {(home.deliverabilityAlerts || []).length === 0 ? (
          <Empty>
            {home.flags?.kill_switch
              ? 'Kill switch ON'
              : home.flags?.campaign_enabled
                ? 'Module enabled'
                : 'Enable campaign flag'}
          </Empty>
        ) : (
          <ul className="space-y-2 text-sm">
            {home.deliverabilityAlerts.map((d) => (
              <li key={d.domain}>
                {d.domain} · {d.status}
              </li>
            ))}
          </ul>
        )}
      </Widget>

      <Widget title="Due now" cta={{ href: `${ECC_ROUTE_PREFIX}/sequences`, label: 'Sequences' }}>
        <Empty>Sequence steps appear when enrollments are due</Empty>
      </Widget>

      <Widget title="DocuSign waiting" cta={{ href: '/shared-services/legal/docusign', label: 'Library' }}>
        <Empty>Envelope waits surface from spine DocuSign</Empty>
      </Widget>
    </div>
  );
}

function Widget({
  title,
  children,
  cta,
}: {
  title: string;
  children: React.ReactNode;
  cta?: { href: string; label: string };
}) {
  return (
    <section className="rounded-xl border border-[#e5e0d6] bg-white/85 p-4 shadow-[0_1px_0_rgba(58,65,79,0.04)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-heading text-base font-semibold text-[#3a414f]">
          {title}
        </h2>
        {cta ? (
          <Link
            href={cta.href}
            className="text-xs font-medium text-[#3a414f] underline-offset-2 hover:underline"
          >
            {cta.label}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[#6b7280]">{children}</p>;
}
