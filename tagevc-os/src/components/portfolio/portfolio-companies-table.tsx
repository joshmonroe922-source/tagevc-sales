import Link from 'next/link';
import { HealthBadge } from '@/components/portfolio/health-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate, formatRunway, formatUsdK } from '@/lib/format';
import type { PortfolioCompany } from '@/lib/types';

export function PortfolioCompaniesTable({
  companies,
}: {
  companies: PortfolioCompany[];
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead>Company</TableHead>
            <TableHead>Path</TableHead>
            <TableHead className="text-right">ARR ($k)</TableHead>
            <TableHead className="text-right">Burn ($k)</TableHead>
            <TableHead className="text-right">Cash ($k)</TableHead>
            <TableHead className="text-right">Runway</TableHead>
            <TableHead>Health</TableHead>
            <TableHead>Top Risk</TableHead>
            <TableHead>Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {companies.map((c) => (
            <TableRow key={c.portfolio_id}>
              <TableCell>
                <Link
                  href={`/portfolio/${c.portfolio_id}`}
                  className="font-medium text-[#3a414f] underline-offset-4 hover:underline"
                >
                  {c.company_name}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {c.portfolio_id}
                  {c.deal_id ? ` · ${c.deal_id}` : ''}
                  {' · '}
                  <Link
                    href={`/entities/${c.entity_id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {c.entity_id}
                  </Link>
                </div>
              </TableCell>
              <TableCell>{c.path ?? '—'}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatUsdK(c.arr_k)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatUsdK(c.net_burn_k)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatUsdK(c.cash_k)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatRunway(c.runway_mo)}
              </TableCell>
              <TableCell>
                <HealthBadge health={c.health} />
              </TableCell>
              <TableCell className="max-w-[14rem] truncate text-sm">
                {c.top_risk ?? '—'}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatDate(c.last_update)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
