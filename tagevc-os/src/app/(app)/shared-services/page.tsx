import Link from 'next/link';
import { BandBadge } from '@/components/shared-services/band-badge';
import { CreateTicketForm } from '@/components/shared-services/create-ticket-form';
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
import { countByBand, listTickets } from '@/lib/data/ticket-store';
import { FORBID_LIST } from '@/lib/shared-services/forbid-list';
import { ALLOW_LIST } from '@/lib/shared-services/allow-list';
import {
  CONFIDENCE_AUTO_MIN,
  CONFIDENCE_DRAFT_MIN,
  CURRENT_POLICY_VERSION,
} from '@/lib/shared-services/diagnose';
import { AUTONOMY_BANDS } from '@/lib/types';

export default async function SharedServicesPage() {
  const tickets = listTickets();
  const bands = countByBand();
  const open = tickets.filter(
    (t) => t.status !== 'Resolved' && t.status !== 'Closed',
  );

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Shared Services
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Grok/Cursor ticketing (§7): Intake → Diagnose → Act → Resolve → Learn.
          Policy version <code>{CURRENT_POLICY_VERSION}</code>. AUTO ≥
          {CONFIDENCE_AUTO_MIN}% on allow-list; DRAFT {CONFIDENCE_DRAFT_MIN}–89%;
          ESCALATE &lt;{CONFIDENCE_DRAFT_MIN}%, P0, or forbid-list.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        {AUTONOMY_BANDS.map((band) => (
          <Card key={band}>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <BandBadge band={band} /> open
              </CardDescription>
              <CardTitle className="font-heading text-2xl tabular-nums">
                {bands[band]}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </section>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Ticket</TableHead>
              <TableHead>Service</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Band</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {open.map((t) => (
              <TableRow key={t.ticket_id}>
                <TableCell>
                  <Link
                    href={`/shared-services/tickets/${t.ticket_id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {t.title}
                  </Link>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{t.ticket_id}</span>
                    {t.ai_generated ? (
                      <Badge
                        variant="outline"
                        className="border-sky-200 bg-sky-50 text-sky-950"
                      >
                        AI
                      </Badge>
                    ) : null}
                    {t.forbid_hits.length
                      ? ` · forbid: ${t.forbid_hits.join(', ')}`
                      : null}
                  </div>
                </TableCell>
                <TableCell>{t.service}</TableCell>
                <TableCell>
                  <Badge variant="outline">{t.priority}</Badge>
                </TableCell>
                <TableCell>
                  <BandBadge band={t.autonomy_band} />
                </TableCell>
                <TableCell className="tabular-nums">{t.confidence}%</TableCell>
                <TableCell>{t.status}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <CreateTicketForm />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Forbid-list (never AUTO)</CardTitle>
            <CardDescription>§7D — even at 99% confidence.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {FORBID_LIST.map((r) => (
              <div key={r.code} className="rounded-md border border-border px-3 py-2">
                <p className="font-medium">{r.label}</p>
                <p className="text-xs text-muted-foreground">
                  {r.code} · Human: {r.human_required}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AUTO allow-list (v1)</CardTitle>
            <CardDescription>
              COO-signed low-risk actions only. Expansion requires written
              sign-off (§7E).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {ALLOW_LIST.map((r) => (
              <div key={r.code} className="rounded-md border border-border px-3 py-2">
                <p className="font-medium">{r.label}</p>
                <p className="text-xs text-muted-foreground">{r.code}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
