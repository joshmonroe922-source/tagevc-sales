'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  approveHrItHighRiskPhase57Action,
  proposeHrItHighRiskPhase57Action,
  recordHrItEscalationPhase57Action,
  refreshHrItHardeningPhase57Action,
} from '@/app/(app)/shared-services/hr/actions';
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
  boardStatusLabel,
  formatCompletenessPct,
  highRiskActionLabel,
  type HighRiskActionKind,
  type HrItHardeningPhase57Report,
} from '@/lib/shared-services/hr-it-hardening-phase57';
import { CompanySelect } from '@/components/shared/company-select';

export function HrItHardeningPhase57Client({
  report: initialReport,
  canWrite,
  initialEntityId = '',
  surface = 'hr',
  showPageHeader = true,
}: {
  report: HrItHardeningPhase57Report;
  canWrite: boolean;
  initialEntityId?: string;
  surface?: 'hr' | 'it';
  /** When false, omit the top-level HR page header (parent already provides one). */
  showPageHeader?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [report, setReport] = useState(initialReport);
  const [entityId, setEntityId] = useState(initialEntityId);
  const [message, setMessage] = useState<string | null>(null);
  const [hrSummary, setHrSummary] = useState('');
  const [hrKind, setHrKind] = useState<HighRiskActionKind>('breaker_close');

  function runRefresh() {
    start(async () => {
      setMessage(null);
      const result = await refreshHrItHardeningPhase57Action(
        entityId.trim() || null,
      );
      if (!result.ok) {
        setMessage(result.error);
        setReport(result.report);
        return;
      }
      setReport(result.report);
      setMessage(
        'HR + IT hardening board refreshed (observe-only; breakers never auto-closed).',
      );
      router.refresh();
    });
  }

  function proposeHighRisk() {
    const summary = hrSummary.trim();
    if (summary.length < 2) {
      setMessage('High-risk summary required.');
      return;
    }
    start(async () => {
      setMessage(null);
      const result = await proposeHrItHighRiskPhase57Action({
        entityId: entityId.trim() || null,
        actionKind: hrKind,
        summary,
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setHrSummary('');
      setReport(result.report);
      setMessage(
        'High-risk action proposed — dual human approval required; never auto-closes breakers.',
      );
      router.refresh();
    });
  }

  function decideHighRisk(
    proposalId: string,
    decision: 'approve' | 'reject',
  ) {
    const ok = window.confirm(
      decision === 'approve'
        ? 'Approve this high-risk proposal? A second distinct human approver is required. Tage never auto-closes breakers and never silently revokes access.'
        : 'Reject this high-risk proposal?',
    );
    if (!ok) return;
    start(async () => {
      setMessage(null);
      const result = await approveHrItHighRiskPhase57Action({
        proposalId,
        decision,
        entityId: entityId.trim() || null,
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setReport(result.report);
      setMessage(
        decision === 'approve'
          ? 'Approval recorded (dual-approve gate; operator executes after gate).'
          : 'Proposal rejected.',
      );
      router.refresh();
    });
  }

  function raiseEscalation() {
    start(async () => {
      setMessage(null);
      const result = await recordHrItEscalationPhase57Action({
        entityId: entityId.trim() || null,
        escalationKind: 'manual',
        title: 'Manual HR/IT escalation from hardening board',
        status: 'escalated',
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setReport(result.report);
      setMessage('Escalation recorded (observe-only).');
      router.refresh();
    });
  }

  const kpis = [
    {
      label: 'Onboarding open',
      value: String(report.onboarding_open),
    },
    {
      label: 'Offboarding open',
      value: String(report.offboarding_open),
    },
    {
      label: 'Completeness',
      value: formatCompletenessPct(report.completeness_pct),
    },
    {
      label: 'HW assigned',
      value: String(report.hardware_assigned),
    },
    {
      label: 'Inbox stale',
      value: String(report.inbox_stale_count),
    },
    {
      label: 'Pending high-risk',
      value: String(report.pending_high_risk_count),
    },
  ];

  const title =
    surface === 'it'
      ? 'IT production hardening (Phase 57)'
      : 'HR operations hardening';

  return (
    <div
      id={surface === 'it' ? 'it-hardening' : 'hr-hardening'}
      className={
        surface === 'hr' ? 'scroll-mt-20 space-y-8' : 'scroll-mt-20'
      }
    >
      {surface === 'hr' && showPageHeader ? (
        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              Board · {boardStatusLabel(report.board_status)}
            </Badge>
            <Badge variant="outline">Never auto-close breakers</Badge>
            <Badge variant="outline">Dual-approve high-risk</Badge>
          </div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
            {title}
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Onboarding and offboarding completeness, assignment visibility,
            access revoke evidence, and escalations. High-risk actions stay
            dual-approved.
          </p>
        </header>
      ) : null}

      <Card>
        {surface === 'it' ? (
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">Phase 57</Badge>
              <Badge variant="secondary">
                Board · {boardStatusLabel(report.board_status)}
              </Badge>
              <Badge variant="outline">Never auto-close breakers</Badge>
            </div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription>
              Run completeness, assignment visibility, revocation evidence,
              dual-approve inbox usability, and exception aging/escalations.
              Approvals still flow through existing Phase 49–51 review actions.
            </CardDescription>
          </CardHeader>
        ) : (
          <CardHeader>
            <CardTitle className="text-base">
              Access & lifecycle hardening
            </CardTitle>
            <CardDescription>
              Completeness, assignment visibility, revoke evidence, and
              escalations. Fail-soft when run tables are empty.
            </CardDescription>
          </CardHeader>
        )}
        <CardContent className="space-y-6 text-sm">
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-xs text-muted-foreground">
              Company filter
              <CompanySelect
                allowAll
                allLabel="All companies"
                value={entityId}
                onChange={setEntityId}
                className="block w-44"
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
              href="/shared-services/it/assets"
              className="inline-flex h-7 items-center rounded-lg px-2.5 text-[0.8rem] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              IT assets
            </Link>
            <Link
              href="/shared-services/hr"
              className="inline-flex h-7 items-center rounded-lg px-2.5 text-[0.8rem] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              HR ops
            </Link>
            <Link
              href="/shared-services?service=HR#inbox"
              className="inline-flex h-7 items-center rounded-lg px-2.5 text-[0.8rem] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              HR inbox
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
            <h3 className="font-medium">Asset / license assignment visibility</h3>
            <p className="text-xs text-muted-foreground">
              Status ·{' '}
              {boardStatusLabel(String(report.assignment_visibility_status))} ·
              HW assigned {report.hardware_assigned} · in stock{' '}
              {report.hardware_in_stock} · seats {report.license_seats_used}/
              {report.license_seats_total}
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-medium">
              Intune dual-approve inbox usability
            </h3>
            <p className="text-xs text-muted-foreground">
              Pending {report.inbox_pending_count} · stale (&gt;24h){' '}
              {report.inbox_stale_count} · critical (&gt;72h){' '}
              {report.inbox_critical_count}. Approvals remain on the IT assets
              Phase 49/50/51 actions — this panel improves aging visibility only.
            </p>
            {report.inbox_items.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No dual-approve inbox items (or Phase 51 inbox unavailable).
              </p>
            ) : (
              <ul className="space-y-1 text-xs">
                {report.inbox_items.slice(0, 12).map((item, idx) => (
                  <li
                    key={`${String(item.kind)}-${idx}`}
                    className="flex flex-wrap justify-between gap-2 border-b py-1 text-muted-foreground"
                  >
                    <span>
                      {String(item.kind ?? 'item').replaceAll('_', ' ')} ·{' '}
                      {String(item.reference_id ?? 'n/a').slice(0, 8)}
                    </span>
                    <span>
                      {item.awaiting_since
                        ? new Date(String(item.awaiting_since)).toLocaleString()
                        : 'n/a'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">Exception aging + escalations</h3>
              {canWrite ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={raiseEscalation}
                >
                  Raise manual escalation
                </Button>
              ) : null}
            </div>
            {report.aging_alerts.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No aging alerts yet — refresh to probe open runs / inbox SLA.
              </p>
            ) : (
              <ul className="space-y-1 text-xs">
                {report.aging_alerts.slice(0, 8).map((alert) => (
                  <li
                    key={
                      alert.alert_id ?? `${alert.alert_kind}-${alert.created_at}`
                    }
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
            {report.escalations.length > 0 ? (
              <ul className="space-y-1 text-xs">
                {report.escalations.slice(0, 6).map((esc) => (
                  <li
                    key={esc.event_id ?? `${esc.escalation_kind}-${esc.created_at}`}
                    className="text-muted-foreground"
                  >
                    {esc.title} · {esc.status} · {esc.escalation_kind}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="space-y-2">
            <h3 className="font-medium">Access revocation evidence</h3>
            <p className="text-xs text-muted-foreground">
              Append-only observe evidence. Access revoke execute requires
              dual-approve; <code>access_revoke_executed</code> stays false
              here.
            </p>
            {report.revocation_evidence.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No revocation evidence yet.
              </p>
            ) : (
              <ul className="space-y-1 text-xs">
                {report.revocation_evidence.slice(0, 8).map((ev) => (
                  <li
                    key={
                      ev.evidence_id ??
                      `${ev.revocation_kind}-${ev.created_at}`
                    }
                    className="text-muted-foreground"
                  >
                    {ev.revocation_kind} · {ev.evidence_status}
                    {ev.run_id ? ` · run ${ev.run_id.slice(0, 8)}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="font-medium">High-risk dual-control</h3>
            <p className="text-xs text-muted-foreground">
              Propose breaker close / access revoke / force-complete. Never
              auto-closes breakers; operator executes after dual-approve.
            </p>
            {canWrite ? (
              <div className="flex flex-wrap gap-2">
                <select
                  className="h-9 rounded-md border bg-background px-2 text-xs"
                  value={hrKind}
                  onChange={(e) =>
                    setHrKind(e.target.value as HighRiskActionKind)
                  }
                >
                  <option value="breaker_close">Breaker close</option>
                  <option value="access_revoke_execute">Access revoke</option>
                  <option value="offboarding_force_complete">
                    Force-complete offboarding
                  </option>
                  <option value="onboarding_force_complete">
                    Force-complete onboarding
                  </option>
                  <option value="other_high_risk">Other high-risk</option>
                </select>
                <input
                  className="h-9 min-w-56 flex-1 rounded-md border bg-background px-2 text-xs"
                  placeholder="High-risk action summary"
                  value={hrSummary}
                  onChange={(e) => setHrSummary(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={proposeHighRisk}
                >
                  Propose high-risk
                </Button>
              </div>
            ) : null}
            {report.high_risk_proposals.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No high-risk proposals yet.
              </p>
            ) : (
              <ul className="space-y-1 text-xs">
                {report.high_risk_proposals.slice(0, 12).map((proposal) => (
                  <li
                    key={proposal.proposal_id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b py-1"
                  >
                    <span>
                      {highRiskActionLabel(String(proposal.action_kind))} ·{' '}
                      {proposal.summary}
                      <span className="block text-muted-foreground">
                        {proposal.status}
                      </span>
                    </span>
                    {canWrite && proposal.status === 'pending' ? (
                      <span className="flex gap-1">
                        <button
                          type="button"
                          className="rounded border px-2 py-0.5"
                          disabled={pending}
                          onClick={() =>
                            decideHighRisk(proposal.proposal_id, 'approve')
                          }
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="rounded border px-2 py-0.5"
                          disabled={pending}
                          onClick={() =>
                            decideHighRisk(proposal.proposal_id, 'reject')
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
            <h3 className="font-medium">Subsidiary HR/IT visibility</h3>
            <p className="text-xs text-muted-foreground">
              Recruit 619 first; Instant NDA when data is available.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {report.subsidiaries.map((sub) => (
                <div className="rounded border p-2 text-xs" key={sub.entity_id}>
                  <p className="font-medium">{sub.name}</p>
                  <p className="text-muted-foreground">
                    {boardStatusLabel(String(sub.visibility_status))} · open
                    runs {sub.open_runs} · aging {sub.aging_alerts}
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
    </div>
  );
}
