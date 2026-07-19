import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { listActiveDeals } from '@/lib/data/deal-flow-store';
import { formatUsdK } from '@/lib/format';

export default async function DealsPage() {
  const deals = listActiveDeals();

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
          <Link href="/deal-flow" className="hover:text-foreground">
            ← Deal Flow hub
          </Link>
          <Link href="/deal-flow/vc" className="hover:text-foreground">
            Pipeline Active
          </Link>
          <Link href="/deal-flow/vc/ic" className="hover:text-foreground">
            IC queue
          </Link>
        </div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Deal Active
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Post–Ready for DD execution desk. Stage moves spawn Deal Process
          Library tasks (DX-##). IC must Approve before leaving IC Approved.
          Wired / Closed opens Portfolio Handoff.
        </p>
      </header>

      {deals.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base">No active deals yet</CardTitle>
            <CardDescription>
              Move a lead to Ready for DD and click Open Deal Active on the lead
              detail page.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Company</TableHead>
                <TableHead>Exec stage</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Check ($k)</TableHead>
                <TableHead>Priority</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deals.map((d) => (
                <TableRow key={d.deal_id}>
                  <TableCell>
                    <Link
                      href={`/deal-flow/vc/deals/${d.deal_id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {d.company_name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {d.deal_id}
                      {d.lead_id ? ` · ${d.lead_id}` : ''}
                    </div>
                  </TableCell>
                  <TableCell>{d.exec_stage}</TableCell>
                  <TableCell>{d.owner ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatUsdK(d.check_k)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{d.priority}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
