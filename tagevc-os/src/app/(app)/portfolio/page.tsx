import Link from 'next/link';
import { PortfolioCompaniesTable } from '@/components/portfolio/portfolio-companies-table';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getMasterDataSource } from '@/lib/data/master-data';
import { listActivePortfolioCompanies, getPortfolioRollup } from '@/lib/data/repositories';
import {
  formatPct,
  formatRunway,
  formatUsdK,
} from '@/lib/format';
import { PORTFOLIO_HEALTH } from '@/lib/types';

export default async function PortfolioPage() {
  const [companies, rollup] = await Promise.all([
    listActivePortfolioCompanies(),
    getPortfolioRollup(),
  ]);
  const source = getMasterDataSource();

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
            Portfolio Active
          </h1>
          <Badge variant="outline" className="font-normal">
            Period {rollup.period}
          </Badge>
          <Badge variant="outline" className="font-normal capitalize">
            {source === 'sql' ? 'Live DB' : source === 'seed+migrating' ? 'Migrating' : 'Seed'}
          </Badge>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          One row per company. COO owns Health + Top Risk. CORE $ fields match
          Portfolio Roll-up for the same period (BD15 pack).
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Companies" value={String(companies.length)} />
        <SummaryCard
          label="Portfolio ARR ($k)"
          value={formatUsdK(rollup.portfolio_arr_k)}
        />
        <SummaryCard
          label="Net Burn ($k)"
          value={formatUsdK(rollup.portfolio_net_burn_k)}
        />
        <SummaryCard
          label="Min runway"
          value={formatRunway(rollup.min_runway_mo)}
          hint={rollup.runway_breach ? 'REVIEW — sub <12 mo' : 'ok'}
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-4">
        {PORTFOLIO_HEALTH.map((status) => (
          <Card key={status}>
            <CardHeader className="pb-2">
              <CardDescription>{status}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {rollup.health_counts[status]}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </section>

      <PortfolioCompaniesTable companies={companies} />

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base">Roll-up proof</CardTitle>
          <CardDescription>
            SUM money · WEIGHTED gross margin from sums · MIN runway among
            burning entities.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            Gross margin{' '}
            <span className="font-medium tabular-nums">
              {formatPct(rollup.portfolio_gross_margin)}
            </span>
          </div>
          <div>
            Portfolio cash{' '}
            <span className="font-medium tabular-nums">
              ${formatUsdK(rollup.portfolio_cash_k)}k
            </span>
          </div>
          <div>
            Consolidated cash{' '}
            <span className="font-medium tabular-nums">
              ${formatUsdK(rollup.consolidated_cash_k)}k
            </span>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Looking for a company? Open a row for the Subsidiary OS, browse{' '}
        <Link href="/entities" className="underline underline-offset-2">
          Entities
        </Link>
        , or jump to{' '}
        <Link href="/command-center" className="underline underline-offset-2">
          Command Center
        </Link>
        .
      </p>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-heading text-2xl tabular-nums">
          {value}
        </CardTitle>
        {hint ? (
          <p className="text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </CardHeader>
    </Card>
  );
}
