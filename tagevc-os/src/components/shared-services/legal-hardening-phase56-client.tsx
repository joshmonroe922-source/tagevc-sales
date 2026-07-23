'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  approveCapitalSendPhase56Action,
  proposeCapitalSendPhase56Action,
  recordQuarterlyProcessPhase56Action,
  refreshLegalHardeningPhase56Action,
} from '@/app/(app)/shared-services/legal/docusign/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  formatCompletenessPct,
  governanceStatusLabel,
  quarterlyStatusLabel,
  type LegalHardeningPhase56Report,
} from '@/lib/docusign/legal-hardening-phase56';

export function LegalHardeningPhase56Client({
  report: initialReport,
  canWrite,
  canCapital,
  initialEntityId = '',
}: {
  report: LegalHardeningPhase56Report;
  canWrite: boolean;
  canCapital: boolean;
  initialEntityId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [report, setReport] = useState(initialReport);
  const [entityId, setEntityId] = useState(initialEntityId);
  const [message, setMessage] = useState<string | null>(null);
  const [capSummary, setCapSummary] = useState('');
  const [capTemplateId, setCapTemplateId] = useState('');
  const [capDocId, setCapDocId] = useState('');

  function runRefresh() {
    start(async () => {
      setMessage(null);
      const result = await refreshLegalHardeningPhase56Action(
        entityId.trim() || null,
      );
      if (!result.ok) {
        setMessage(result.error);
        setReport(result.report);
        return;
      }
      setReport(result.report);
      setMessage(
        'Legal / DocuSign hardening board refreshed (observe-only; no envelopes mutated).',
      );
      router.refresh();
    });
  }

  function markQuarterly(
    stepKey: string,
    stepLabel: string,
    status: 'done' | 'in_progress' | 'blocked',
  ) {
    start(async () => {
      setMessage(null);
      const result = await recordQuarterlyProcessPhase56Action({
        entityId: entityId.trim() || null,
        periodKey: report.period_key,
        stepKey,
        stepLabel,
        status,
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setReport(result.report);
      setMessage(`Quarterly step ${stepKey} → ${status}`);
      router.refresh();
    });
  }

  function proposeCapital() {
    const summary = capSummary.trim();
    if (summary.length < 2) {
      setMessage('Capital send summary required.');
      return;
    }
    if (!capTemplateId.trim() && !capDocId.trim()) {
      setMessage('Template ID or document ID required for capital propose.');
      return;
    }
    start(async () => {
      setMessage(null);
      const result = await proposeCapitalSendPhase56Action({
        entityId: entityId.trim() || null,
        templateId: capTemplateId.trim() || null,
        docId: capDocId.trim() || null,
        summary,
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setCapSummary('');
      setReport(result.report);
      setMessage(
        'Capital send proposed — dual human approval required; envelope not sent.',
      );
      router.refresh();
    });
  }

  function decideCapital(
    proposalId: string,
    decision: 'approve' | 'reject',
  ) {
    const ok = window.confirm(
      decision === 'approve'
        ? 'Approve this capital DocuSign send proposal? A second distinct human approver is required. Tage never silent-sends capital envelopes.'
        : 'Reject this capital send proposal?',
    );
    if (!ok) return;
    start(async () => {
      setMessage(null);
      const result = await approveCapitalSendPhase56Action({
        proposalId,
        decision,
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setReport(result.report);
      setMessage(
        decision === 'approve'
          ? 'Approval recorded (dual-approve gate; operator sends after gate).'
          : 'Capital send proposal rejected.',
      );
      router.refresh();
    });
  }

  const kpis = [
    {
      label: 'Templates cached',
      value: String(report.templates_cached),
    },
    {
      label: 'With roles',
      value: String(report.templates_with_roles),
    },
    {
      label: 'Governance',
      value: governanceStatusLabel(report.governance_status),
    },
    {
      label: 'Completeness',
      value: formatCompletenessPct(report.completeness_pct),
    },
    {
      label: 'Pending capital',
      value: String(report.pending_capital_send_count),
    },
    {
      label: 'Quarantine',
      value: String(report.quarantine_count),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Phase 56</Badge>
          <Badge variant="secondary">
            Governance · {governanceStatusLabel(report.governance_status)}
          </Badge>
          <Badge variant="outline">Never silent send</Badge>
          <Badge variant="outline">No create/void/resend</Badge>
        </div>
        <CardTitle className="text-base">
          Legal / DocuSign production hardening
        </CardTitle>
        <CardDescription>
          Template governance completeness, capital dual-control, archive
          integrity alerts, quarterly process monitoring, and subsidiary legal
          visibility ({report.period_key}). Monitoring never creates, voids, or
          resends envelopes. Capital sends are propose + dual-approve only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-xs text-muted-foreground">
            Entity filter
            <input
              className="block h-9 w-44 rounded-md border border-border bg-background px-2 text-sm"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              placeholder="ENT-R619"
            />
          </label>
          <Button
            type="button"
            variant="outline"
            disabled={pending || !canWrite}
            onClick={runRefresh}
          >
            Refresh hardening board
          </Button>
          <Link
            href="/shared-services?service=Legal#inbox"
            className="inline-flex h-7 items-center rounded-lg px-2.5 text-[0.8rem] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Legal inbox
          </Link>
        </div>
        {message ? (
          <p className="text-sm text-muted-foreground">{message}</p>
        ) : null}
        {report.todo ? (
          <p className="text-xs text-muted-foreground">TODO · {report.todo}</p>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {kpis.map((kpi) => (
            <div className="rounded border p-2" key={kpi.label}>
              <p className="text-xs text-muted-foreground">{kpi.label}</p>
              <p className="text-lg font-semibold tabular-nums">{kpi.value}</p>
            </div>
          ))}
        </div>

        <section className="space-y-2">
          <h3 className="font-medium">Quarterly process monitoring</h3>
          <p className="text-xs text-muted-foreground">
            Append-only orchestration for {report.period_key}. Completing a step
            does not create or send envelopes.
          </p>
          {report.quarterly_steps.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No quarterly steps yet — refresh the board to seed stubs.
            </p>
          ) : (
            <ul className="space-y-1 text-xs">
              {report.quarterly_steps.map((step) => (
                <li
                  key={step.step_key}
                  className="flex flex-wrap items-center justify-between gap-2 border-b py-1"
                >
                  <span>
                    {step.step_label}{' '}
                    <span className="text-muted-foreground">
                      · {quarterlyStatusLabel(step.status)}
                    </span>
                  </span>
                  {canWrite ? (
                    <span className="flex gap-1">
                      <button
                        type="button"
                        className="rounded border px-2 py-0.5"
                        disabled={pending}
                        onClick={() =>
                          markQuarterly(
                            step.step_key,
                            step.step_label,
                            'in_progress',
                          )
                        }
                      >
                        Start
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-0.5"
                        disabled={pending}
                        onClick={() =>
                          markQuarterly(step.step_key, step.step_label, 'done')
                        }
                      >
                        Done
                      </button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">Capital send dual-control</h3>
          <p className="text-xs text-muted-foreground">
            Propose capital DocuSign sends for dual human approval. Envelope is
            never sent from this gate — operator sends after dual-approve.
          </p>
          {canCapital ? (
            <div className="flex flex-wrap gap-2">
              <input
                className="h-9 min-w-40 rounded-md border bg-background px-2 text-xs"
                placeholder="Template ID"
                value={capTemplateId}
                onChange={(e) => setCapTemplateId(e.target.value)}
              />
              <input
                className="h-9 min-w-36 rounded-md border bg-background px-2 text-xs"
                placeholder="Doc ID (optional)"
                value={capDocId}
                onChange={(e) => setCapDocId(e.target.value)}
              />
              <input
                className="h-9 min-w-56 flex-1 rounded-md border bg-background px-2 text-xs"
                placeholder="Capital send summary"
                value={capSummary}
                onChange={(e) => setCapSummary(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={proposeCapital}
              >
                Propose capital send
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Requires <code>action:docusign_capital</code> to propose.
            </p>
          )}
          {report.capital_send_proposals.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No capital send proposals yet.
            </p>
          ) : (
            <ul className="space-y-1 text-xs">
              {report.capital_send_proposals.slice(0, 12).map((proposal) => (
                <li
                  key={proposal.proposal_id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b py-1"
                >
                  <span>
                    {proposal.summary}
                    <span className="block text-muted-foreground">
                      {proposal.status}
                      {proposal.template_id
                        ? ` · template ${proposal.template_id}`
                        : ''}
                      {proposal.doc_id ? ` · doc ${proposal.doc_id}` : ''}
                    </span>
                  </span>
                  {canCapital && proposal.status === 'pending' ? (
                    <span className="flex gap-1">
                      <button
                        type="button"
                        className="rounded border px-2 py-0.5"
                        disabled={pending}
                        onClick={() =>
                          decideCapital(proposal.proposal_id, 'approve')
                        }
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-0.5"
                        disabled={pending}
                        onClick={() =>
                          decideCapital(proposal.proposal_id, 'reject')
                        }
                      >
                        Reject
                      </button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">Archive integrity alerts</h3>
          {report.archive_alerts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No archive integrity alerts yet — refresh to probe quarantine.
            </p>
          ) : (
            <ul className="space-y-1 text-xs">
              {report.archive_alerts.slice(0, 8).map((alert) => (
                <li
                  key={alert.alert_id ?? `${alert.alert_kind}-${alert.created_at}`}
                  className="flex flex-wrap justify-between gap-2 border-b py-1"
                >
                  <span>
                    {alert.title}
                    <span className="block text-muted-foreground">
                      {alert.alert_kind} · {alert.severity}
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    {alert.created_at
                      ? new Date(alert.created_at).toLocaleString()
                      : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">Subsidiary legal visibility</h3>
          <p className="text-xs text-muted-foreground">
            Recruit 619 first; Instant NDA when data is available.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {report.subsidiaries.map((sub) => (
              <div className="rounded border p-2 text-xs" key={sub.entity_id}>
                <p className="font-medium">{sub.name}</p>
                <p className="text-muted-foreground">
                  {governanceStatusLabel(String(sub.visibility_status))} · open{' '}
                  {sub.open_count} · overdue {sub.overdue_count}
                  {sub.has_data ? ' · has data' : ' · stub'}
                </p>
                {sub.todo ? (
                  <p className="text-muted-foreground">TODO · {sub.todo}</p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
