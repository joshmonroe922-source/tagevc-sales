import Link from 'next/link';
import { IcDecisionForm } from '@/components/deal-flow/ic-decision-form';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
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
import { getDeal, listIcQueue } from '@/lib/data/deal-flow-store';

export default async function IcQueuePage() {
  const reviews = listIcQueue();
  const open = reviews.filter(
    (r) => r.status === 'Pending' || r.status === 'In Review',
  );

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
          <Link href="/deal-flow" className="hover:text-foreground">
            ← Deal Flow hub
          </Link>
          <Link href="/deal-flow/vc" className="hover:text-foreground">
            Pipeline
          </Link>
          <Link href="/deal-flow/vc/deals" className="hover:text-foreground">
            Deal Active
          </Link>
        </div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Investment Committee
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Human gate for VC Deal Active. Decisions: Approve / Pass / Defer /
          Approve with conditions. Advancing past IC Approved requires Approve.
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{open.length} open</Badge>
          <Badge variant="outline">{reviews.length} total</Badge>
        </div>
      </header>

      {open.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {open.map((r) => (
            <Card key={r.ic_id}>
              <CardHeader>
                <CardTitle className="text-base">
                  <Link
                    href={`/deal-flow/vc/deals/${r.deal_id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {r.company_name}
                  </Link>
                </CardTitle>
                <CardDescription>
                  {r.ic_id} · {r.deal_id} · {r.status}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <IcDecisionForm icId={r.ic_id} />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base">No open IC reviews</CardTitle>
            <CardDescription>
              Convert a Ready for DD lead to Deal Active, or open a deal at IC
              Approved and click Submit to IC.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Company</TableHead>
              <TableHead>IC</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Decision</TableHead>
              <TableHead>Deal stage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reviews.map((r) => {
              const deal = getDeal(r.deal_id);
              return (
                <TableRow key={r.ic_id}>
                  <TableCell>
                    <Link
                      href={`/deal-flow/vc/deals/${r.deal_id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {r.company_name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {r.deal_id}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{r.ic_id}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{r.status}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.decision ?? '—'}
                    {r.conditions ? (
                      <div className="max-w-[16rem] truncate text-xs text-muted-foreground">
                        {r.conditions}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm">
                    {deal?.exec_stage ?? '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
