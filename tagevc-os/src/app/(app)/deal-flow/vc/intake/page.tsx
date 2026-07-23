import Link from 'next/link';
import { CreateLeadForm } from '@/components/deal-flow/create-lead-form';
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
import { listSubsidiaryEntities } from '@/lib/data/entity-os';
import { listScopedAllLeads } from '@/lib/data/pipeline-scope';
import { entityDisplayName } from '@/lib/entities/display-name';
import { formatDate } from '@/lib/format';

/**
 * Inbound Lead Intake — Portal Architecture / How We Run.
 * Website / associate intake → Pipeline Active (Sourced) → stage tasks.
 * Optional related_entity_id links follow-ons to Subsidiary OS.
 */
export default async function LeadIntakePage() {
  const [entities, leads] = await Promise.all([
    listSubsidiaryEntities(),
    listScopedAllLeads(),
  ]);
  const recent = leads.slice(0, 12);
  const inbound = leads.filter((l) => l.source === 'Inbound').slice(0, 8);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <Link
          href="/deal-flow"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Deal Flow
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
            Lead Intake
          </h1>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Log a company, source, and owner. New opportunities start here, then
          move through Deal Flow and into portfolio companies after close.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Recent leads</CardDescription>
            <CardTitle className="font-heading text-2xl tabular-nums">
              {recent.length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Incoming</CardDescription>
            <CardTitle className="font-heading text-2xl tabular-nums">
              {inbound.length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Company follow-ons</CardDescription>
            <CardTitle className="font-heading text-2xl tabular-nums">
              {entities.length}
            </CardTitle>
          </CardHeader>
        </Card>
      </section>

      <CreateLeadForm
        entities={entities.map((e) => ({
          entity_id: e.entity_id,
          canonical_name: e.canonical_name,
        }))}
        defaultSource="Inbound"
        showRelatedEntity
        title="New opportunity"
        description="Required: company, source, and owner. Link a related company when this is a follow-on (for example Instant NDA)."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent intake</CardTitle>
          <CardDescription>
            Newest opportunities, including ones that already closed into a
            company.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-hidden rounded-lg border border-border p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Lead</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Company link</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((l) => (
                <TableRow key={l.lead_id}>
                  <TableCell>
                    {l.archived_at ? (
                      <span className="font-medium">{l.company_name}</span>
                    ) : (
                      <Link
                        href={`/deal-flow/vc/leads/${l.lead_id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {l.company_name}
                      </Link>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {l.lead_id}
                      {l.archived_at ? ' · archived' : ''}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>{l.source ?? '—'}</div>
                    {l.source_detail ? (
                      <div className="text-xs text-muted-foreground">
                        {l.source_detail}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>{l.stage}</TableCell>
                  <TableCell>
                    {l.related_entity_id ? (
                      <Link
                        href={`/entities/${l.related_entity_id}`}
                        className="text-sm underline-offset-4 hover:underline"
                      >
                        {entityDisplayName(l.related_entity_id)}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(l.created_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Try Instant NDA entity OS:{' '}
        <Link
          href="/entities/ENT-002"
          className="underline underline-offset-2"
        >
          /entities/ENT-002
        </Link>{' '}
        · origin LD-006 (Inbound) + follow-on LD-007.
      </p>
    </div>
  );
}
