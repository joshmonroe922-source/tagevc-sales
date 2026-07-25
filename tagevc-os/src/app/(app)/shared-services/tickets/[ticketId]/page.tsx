import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BandBadge } from '@/components/shared-services/band-badge';
import { TicketHumanActions } from '@/components/shared-services/ticket-actions';
import { StartChatButton } from '@/components/messaging/start-chat-button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  getTicket,
  hydrateTicketStore,
  listAuditsForTicket,
} from '@/lib/data/ticket-store';
import { entityDisplayName } from '@/lib/entities/display-name';
import { ticketContextHeader } from '@/lib/multi-sub/ss-operator';
import { forbidLabel } from '@/lib/shared-services/forbid-list';
import { formatDate } from '@/lib/format';

type Props = { params: Promise<{ ticketId: string }> };

export default async function TicketDetailPage({ params }: Props) {
  const { ticketId } = await params;
  await hydrateTicketStore({ forceSql: true });
  const ticket = getTicket(ticketId);
  if (!ticket) notFound();
  const audits = listAuditsForTicket(ticket.ticket_id);
  const showDraft =
    ticket.autonomy_band === 'DRAFT' && ticket.draft_approval === 'pending';
  const ctxHeader = ticketContextHeader(ticket);

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link
          href="/shared-services"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Shared Services
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {ctxHeader.headline}
            </p>
            <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
              {ticket.title}
            </h1>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="secondary">{ticket.service}</Badge>
              <Badge variant="outline">{ticket.priority}</Badge>
              <BandBadge band={ticket.autonomy_band} />
              <Badge variant="outline">{ticket.confidence}%</Badge>
              <Badge variant="secondary">{ticket.status}</Badge>
              <Badge
                variant={ctxHeader.scope === 'parent' ? 'secondary' : 'outline'}
              >
                {ctxHeader.entity_label}
              </Badge>
              {ticket.ai_generated ? (
                <Badge
                  variant="outline"
                  className="border-sky-200 bg-sky-50 text-sky-950"
                >
                  AI-generated
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StartChatButton
              refType="ticket"
              refId={ticket.ticket_id}
              title={`${ctxHeader.entity_label} · ${ticket.title}`}
              entityId={ticket.entity_id}
            />
            <TicketHumanActions
              ticketId={ticket.ticket_id}
              showDraftActions={showDraft}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Request details</CardTitle>
            <CardDescription>Who asked, for which company, and when it’s due.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Requester" value={ticket.requester_name ?? '—'} />
            <Row label="Assignee" value={ticket.assignee_name ?? '—'} />
            <Row
              label="Company"
              value={entityDisplayName({
                company_name: ticket.company_name,
                entity_id: ticket.entity_id,
              })}
            />
            <Row label="Due" value={formatDate(ticket.sla_due_at)} />
            <Row label="Links" value={ticket.links ?? '—'} />
            {ticket.ai_generated ? (
              <Row label="Origin" value="AI follow-up from a document" />
            ) : null}
            <Separator />
            <Row label="Description" value={ticket.description ?? '—'} />
            <Row
              label="Desired outcome"
              value={ticket.desired_outcome ?? '—'}
            />
            {ticket.source_doc_id ? (
              <p className="text-sm">
                <Link
                  href={`/documents/${ticket.source_doc_id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  Open source document →
                </Link>
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Diagnose</CardTitle>
            <CardDescription>
              Band + confidence · policy {ticket.policy_version}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Band" value={ticket.autonomy_band} />
            <Row label="Confidence" value={`${ticket.confidence}%`} />
            <Row
              label="Allow-list"
              value={ticket.on_allow_list ? 'yes' : 'no'}
            />
            <Row
              label="Proposed action"
              value={ticket.proposed_action ?? '—'}
            />
            <Row label="Draft approval" value={ticket.draft_approval} />
            <Row
              label="Source"
              value={`${ticket.source_system ?? 'tage'}${ticket.source_ref ? ` · ${ticket.source_ref}` : ''}`}
            />
            <Row
              label="AUTO result"
              value={
                ticket.auto_result
                  ? `${ticket.auto_result}${ticket.auto_attempted_at ? ` · ${ticket.auto_attempted_at.slice(0, 19)}` : ''}`
                  : '—'
              }
            />
            {ticket.escalation_reason ? (
              <Row label="Escalation reason" value={ticket.escalation_reason} />
            ) : null}
            <Separator />
            <Row
              label="AI summary"
              value={ticket.diagnose_summary || ticket.diagnose_reasoning}
            />
            <Row label="Reasoning" value={ticket.diagnose_reasoning} />
            <Row
              label="Recommendation"
              value={ticket.recommendation ?? '—'}
            />
            {(ticket.proposed_actions?.length ?? 0) > 0 ? (
              <div className="rounded-md border border-border px-3 py-2">
                <p className="font-medium">Proposed actions</p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs">
                  {ticket.proposed_actions!.map((a, i) => (
                    <li key={`${a.code}-${i}`}>
                      <span className="font-medium">{a.label || a.code}</span>
                      {a.requires_human ? ' · needs human' : ' · AUTO-eligible'}
                      {a.note ? ` — ${a.note}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {ticket.forbid_hits.length > 0 ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-900">
                <p className="font-medium">Forbid-list hits</p>
                <ul className="mt-1 list-disc pl-4 text-xs">
                  {ticket.forbid_hits.map((h) => (
                    <li key={h}>
                      {h} — {forbidLabel(h)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No forbid-list hits.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audit log</CardTitle>
          <CardDescription>
            §7F — every agent action writes an append-only row.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {audits.map((a) => (
            <div
              key={a.audit_id}
              className="rounded-md border border-border px-3 py-2 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <BandBadge band={a.band} />
                <span className="font-medium">{a.action}</span>
                <span className="text-xs text-muted-foreground">
                  {a.actor} · {a.confidence}%
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{a.reasoning}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-36 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 font-medium">{value}</dd>
    </div>
  );
}
