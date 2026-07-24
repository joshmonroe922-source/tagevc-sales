'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  approveMarketingPublishPhase58Action,
  proposeMarketingPublishPhase58Action,
  recordRecruitAcquisitionIntakePhase58Action,
  refreshMarketingHardeningPhase58Action,
} from '@/app/(app)/shared-services/marketing/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CompanySelect } from '@/components/shared/company-select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  boardStatusLabel,
  formatReliabilityPct,
  publishActionLabel,
  type MarketingHardeningPhase58Report,
  type PublishActionKind,
} from '@/lib/shared-services/marketing-hardening-phase58';

export function MarketingHardeningPhase58Client({
  report: initialReport,
  canWrite,
  initialEntityId = '',
}: {
  report: MarketingHardeningPhase58Report;
  canWrite: boolean;
  initialEntityId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [report, setReport] = useState(initialReport);
  const [entityId, setEntityId] = useState(initialEntityId);
  const [message, setMessage] = useState<string | null>(null);
  const [pubSummary, setPubSummary] = useState('');
  const [pubKind, setPubKind] = useState<PublishActionKind>('paid_publish');

  function runRefresh() {
    start(async () => {
      setMessage(null);
      const result = await refreshMarketingHardeningPhase58Action(
        entityId.trim() || null,
      );
      if (!result.ok) {
        setMessage(result.error);
        setReport(result.report);
        return;
      }
      setReport(result.report);
      setMessage(
        'Marketing hardening board refreshed (observe-only; never auto-approves money).',
      );
      router.refresh();
    });
  }

  function proposePublish() {
    const summary = pubSummary.trim();
    if (summary.length < 2) {
      setMessage('Publish proposal summary required.');
      return;
    }
    start(async () => {
      setMessage(null);
      const result = await proposeMarketingPublishPhase58Action({
        entityId: entityId.trim() || null,
        actionKind: pubKind,
        summary,
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setPubSummary('');
      setReport(result.report);
      setMessage(
        'Money-impacting action proposed — dual human approval required; never auto-approves money.',
      );
      router.refresh();
    });
  }

  function decidePublish(
    proposalId: string,
    decision: 'approve' | 'reject',
  ) {
    const ok = window.confirm(
      decision === 'approve'
        ? 'Approve this money-impacting proposal? A second distinct human approver is required. Tage never auto-approves money and never executes publish from this gate.'
        : 'Reject this money-impacting proposal?',
    );
    if (!ok) return;
    start(async () => {
      setMessage(null);
      const result = await approveMarketingPublishPhase58Action({
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

  function recordRecruitStub() {
    start(async () => {
      setMessage(null);
      const result = await recordRecruitAcquisitionIntakePhase58Action({
        entityId: 'ENT-R619',
        sourceKind: 'manual_stub',
        feedStatus: 'missing',
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setReport(result.report);
      setMessage(
        'Recruit acquisition stub recorded (fail-soft; TODO wire Appcast/careers).',
      );
      router.refresh();
    });
  }

  const kpis = [
    {
      label: 'In review',
      value: String(report.in_review_count),
    },
    {
      label: 'Overdue SLA',
      value: String(report.overdue_count),
    },
    {
      label: 'SLA reliability',
      value: formatReliabilityPct(report.sla_reliability_pct),
    },
    {
      label: 'Pending publish jobs',
      value: String(report.pending_jobs),
    },
    {
      label: 'Brand voices',
      value: String(report.voices_configured),
    },
    {
      label: 'Pending money gates',
      value: String(report.pending_publish_proposals),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Phase 58</Badge>
          <Badge variant="secondary">
            Board · {boardStatusLabel(report.board_status)}
          </Badge>
          <Badge variant="outline">Never auto-approve money</Badge>
          <Badge variant="outline">Dual-approve publish</Badge>
        </div>
        <CardTitle className="text-base">
          Marketing production hardening
        </CardTitle>
        <CardDescription>
          Approval SLA reliability, publishing controls, entity brand-voice
          enforcement, campaign/performance dashboards, and Recruit acquisition
          intelligence (Appcast/careers) for ENT-R619. Extends existing revenue
          phase surfaces; money-impacting actions stay dual-approved.
        </CardDescription>
      </CardHeader>
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
            href="/shared-services?service=Marketing#inbox"
            className="inline-flex h-7 items-center rounded-lg px-2.5 text-[0.8rem] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Marketing inbox
          </Link>
          <Link
            href="/entities/ENT-R619"
            className="inline-flex h-7 items-center rounded-lg px-2.5 text-[0.8rem] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Recruit 619
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
          <h3 className="font-medium">Publishing controls</h3>
          <p className="text-xs text-muted-foreground">
            Status ·{' '}
            {boardStatusLabel(String(report.publishing_control_status))} ·
            pending {report.pending_jobs} · failed {report.failed_jobs} · posted{' '}
            {report.posted_jobs}. Money-impacting publish stays gated —
            <code> publish_executed</code> remains false here.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">Entity brand-voice enforcement</h3>
          <p className="text-xs text-muted-foreground">
            Status · {boardStatusLabel(String(report.brand_voice_status))} ·
            voices {report.voices_configured} · content without voice{' '}
            {report.content_without_voice}
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">Campaign / performance dashboard</h3>
          <p className="text-xs text-muted-foreground">
            Status · {boardStatusLabel(String(report.performance_status))} ·
            active {report.active_campaigns} · paid {report.paid_campaigns} ·
            organic {report.organic_campaigns}. Extends Phase 41–52 revenue
            surfaces (observe only).
          </p>
        </section>

        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">
              Recruit acquisition intelligence (ENT-R619)
            </h3>
            {canWrite ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={recordRecruitStub}
              >
                Record Appcast/careers stub
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Feed · {boardStatusLabel(String(report.recruit_feed_status))} ·
            applications {report.recruit_applications} · clicks{' '}
            {report.recruit_clicks}. Fail-soft when Appcast/careers feed is
            absent.
          </p>
          {report.recruit_acquisition.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              TODO · wire Appcast/careers feed for ENT-R619
            </p>
          ) : (
            <ul className="space-y-1 text-xs">
              {report.recruit_acquisition.slice(0, 8).map((ev) => (
                <li
                  key={ev.event_id ?? `${ev.source_kind}-${ev.created_at}`}
                  className="text-muted-foreground"
                >
                  {ev.source_kind} · {ev.feed_status} · apps {ev.applications} ·
                  clicks {ev.clicks}
                  {ev.todo ? ` · ${ev.todo}` : ''}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">Money-impacting dual-control</h3>
          <p className="text-xs text-muted-foreground">
            Propose paid publish / budget change / campaign go-live. Never
            auto-approves money; operator executes after dual-approve.
          </p>
          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              <select
                className="h-9 rounded-md border bg-background px-2 text-xs"
                value={pubKind}
                onChange={(e) =>
                  setPubKind(e.target.value as PublishActionKind)
                }
              >
                <option value="paid_publish">Paid publish</option>
                <option value="budget_change">Budget change</option>
                <option value="campaign_go_live">Campaign go-live</option>
                <option value="brand_voice_override">
                  Brand-voice override
                </option>
                <option value="other_money_impact">Other money-impact</option>
              </select>
              <input
                className="h-9 min-w-56 flex-1 rounded-md border bg-background px-2 text-xs"
                placeholder="Money-impacting action summary"
                value={pubSummary}
                onChange={(e) => setPubSummary(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={proposePublish}
              >
                Propose money gate
              </Button>
            </div>
          ) : null}
          {report.publish_proposals.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No money-impacting proposals yet.
            </p>
          ) : (
            <ul className="space-y-1 text-xs">
              {report.publish_proposals.slice(0, 12).map((proposal) => (
                <li
                  key={proposal.proposal_id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b py-1"
                >
                  <span>
                    {publishActionLabel(String(proposal.action_kind))} ·{' '}
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
                          decidePublish(proposal.proposal_id, 'approve')
                        }
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-0.5"
                        disabled={pending}
                        onClick={() =>
                          decidePublish(proposal.proposal_id, 'reject')
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
      </CardContent>
    </Card>
  );
}
