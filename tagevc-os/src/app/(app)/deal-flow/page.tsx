import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  listScopedActiveDeals,
  listScopedActiveLeads,
  listScopedActiveMaTargets,
  listScopedActiveReDeals,
  listScopedIcQueue,
} from '@/lib/data/pipeline-scope';

export default async function DealFlowHubPage() {
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
      title: 'VC Invest',
      description:
        'Pipeline Active → Ready for DD → Deal Active → IC → wire → Portfolio Handoff.',
      stats: [
        `${leads.length} leads`,
        `${deals.length} deals`,
        `${icPending} IC open`,
      ],
      accent: "border-[#3a414f]",
    },
    {
      href: '/deal-flow/ma',
      title: 'M&A Buy',
      description:
        'Sourced → CIM → Mgmt → IOI → LOI → DD → Docs → Closing → Integration.',
      stats: [`${ma.length} targets`, 'QoE · LOI · Integration'],
      accent: "border-[#4a5568]",
    },
    {
      href: '/deal-flow/re',
      title: 'RE Buy',
      description:
        'Residential + Commercial. Sourced → Screen → UW → Offer → PSA → Diligence → Closing → Onboard.',
      stats: [`${re.length} assets`, `${resi} resi`, `${cre} CRE`],
      accent: "border-[#6b5b4f]",
    },
  ];

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Deal Flow
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Three tracks — VC Invest, M&A Buy, RE Buy. Join pre-close on company /
          asset name; post-close handoff into Portfolio Active.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        {tracks.map((t) => (
          <Link key={t.href} href={t.href} className="group block">
            <Card
              className={`h-full transition-colors group-hover:bg-muted/30 ${t.accent} border-l-4`}
            >
              <CardHeader>
                <CardTitle className="font-heading text-xl">{t.title}</CardTitle>
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

      <div className="flex flex-wrap gap-4 text-sm">
        <Link
          href="/deal-flow/vc/deals"
          className="font-medium underline-offset-4 hover:underline"
        >
          VC Deal Active →
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
          Portfolio Active →
        </Link>
      </div>
    </div>
  );
}
