import Link from 'next/link';
import { DealFlowTrackTabs } from '@/components/deal-flow/deal-flow-track-tabs';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ViewModeLayout } from '@/components/ui/view-mode-toggle';
import {
  listScopedActiveDeals,
  listScopedActiveLeads,
  listScopedActiveMaTargets,
  listScopedActiveReDeals,
  listScopedIcQueue,
} from '@/lib/data/pipeline-scope';
import { VIEW_MODE_DEFAULTS } from '@/lib/view-mode';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/ui/skeleton';

async function DealFlowTracks() {
  const [leads, deals, icQueue, ma, re] = await Promise.all([
    listScopedActiveLeads(),
    listScopedActiveDeals(),
    listScopedIcQueue(),
    listScopedActiveMaTargets(),
    listScopedActiveReDeals(),
  ]);
  const icPending = icQueue.filter(
    (r) => r.status === 'Pending' || r.status === 'In Review',
  ).length;
  const resi = re.filter((d) => d.route === 'Residential').length;
  const cre = re.filter((d) => d.route === 'Commercial').length;

  const tracks = [
    {
      href: '/deal-flow/vc',
      title: 'VC',
      description:
        'Source leads, diligence, investment committee, close, then hand off to portfolio.',
      stats: [
        `${leads.length} leads`,
        `${deals.length} deals`,
        `${icPending} IC open`,
      ],
      accent: 'border-[#3a414f]',
    },
    {
      href: '/deal-flow/ma',
      title: 'M&A',
      description:
        'Source targets through CIM, LOI, diligence, closing, and integration.',
      stats: [`${ma.length} targets`, 'LOI · diligence · close'],
      accent: 'border-[#4a5568]',
    },
    {
      href: '/deal-flow/re',
      title: 'Real Estate',
      description:
        'Residential and commercial assets from screen through underwriting to close.',
      stats: [`${re.length} assets`, `${resi} residential`, `${cre} commercial`],
      accent: 'border-[#6b5b4f]',
    },
  ];

  return (
    <>
      <ViewModeLayout
        surface="deal-flow-tracks"
        defaultMode={VIEW_MODE_DEFAULTS['deal-flow-tracks']}
        cards={
          <div className="grid gap-4 lg:grid-cols-3">
            {tracks.map((t) => (
              <Link key={t.href} href={t.href} className="group block">
                <Card
                  className={`h-full transition-colors group-hover:bg-muted/30 ${t.accent} border-l-4`}
                >
                  <CardHeader>
                    <CardTitle className="font-heading text-xl">
                      {t.title}
                    </CardTitle>
                    <CardDescription className="text-sm leading-relaxed">
                      {t.description}
                    </CardDescription>
                    <div className="flex flex-wrap gap-2 pt-2">
                      {t.stats.map((s) => (
                        <Badge key={s} variant="secondary" className="font-normal">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        }
        list={
          <div className="overflow-hidden rounded-lg border border-border bg-card divide-y divide-border">
            {tracks.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className={`flex flex-wrap items-center justify-between gap-3 border-l-4 px-4 py-3 hover:bg-muted/40 ${t.accent}`}
              >
                <div className="min-w-0">
                  <p className="font-heading text-base font-semibold text-[#3a414f]">
                    {t.title}
                  </p>
                  <p className="text-xs text-muted-foreground line-clamp-1">
                    {t.description}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {t.stats.map((s) => (
                    <Badge key={s} variant="secondary" className="font-normal">
                      {s}
                    </Badge>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        }
      />

      <div className="flex flex-wrap gap-4 text-sm">
        <Link
          href="/deal-flow/vc/intake"
          className="font-medium underline-offset-4 hover:underline"
        >
          Lead Intake →
        </Link>
        <Link
          href="/deal-flow/vc/deals"
          className="font-medium underline-offset-4 hover:underline"
        >
          View deals →
        </Link>
        <Link
          href="/deal-flow/vc/ic"
          className="font-medium underline-offset-4 hover:underline"
        >
          IC queue →
        </Link>
        <Link
          href="/portfolio"
          className="font-medium underline-offset-4 hover:underline"
        >
          Dashboard →
        </Link>
      </div>
    </>
  );
}

export default function DealFlowHubPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Deal Flow
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Venture, M&A, and real estate pipelines in one place. Use the tracks
          below — or Lead Intake for new opportunities.
        </p>
        <DealFlowTrackTabs active="hub" />
      </header>
      <Suspense fallback={<PageSkeleton cards={3} showTable={false} />}>
        <DealFlowTracks />
      </Suspense>
    </div>
  );
}
