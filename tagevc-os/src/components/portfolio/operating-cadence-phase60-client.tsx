'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  recordPortfolioReviewPacketPhase60Action,
  recordPortfolioRiskMilestonePhase60Action,
  refreshPortfolioOperatingCadencePhase60Action,
} from '@/app/(app)/portfolio/actions';
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
  packetKindLabel,
  riskMilestoneLabel,
  type PortfolioOperatingCadencePhase60Report,
  type ReviewPacketKind,
  type RiskMilestoneKind,
} from '@/lib/portfolio/operating-cadence-phase60';
import { entityDisplayName } from '@/lib/entities/display-name';
import { CompanySelect } from '@/components/shared/company-select';

export function OperatingCadencePhase60Client({
  report: initialReport,
  canWrite,
  initialEntityId = '',
}: {
  report: PortfolioOperatingCadencePhase60Report;
  canWrite: boolean;
  initialEntityId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [report, setReport] = useState(initialReport);
  const [entityId, setEntityId] = useState(initialEntityId);
  const [message, setMessage] = useState<string | null>(null);
  const [rmTitle, setRmTitle] = useState('');
  const [rmKind, setRmKind] = useState<RiskMilestoneKind>('risk');
  const [pktTitle, setPktTitle] = useState('');
  const [pktKind, setPktKind] = useState<ReviewPacketKind>('weekly_ops');

  function runRefresh() {
    start(async () => {
      setMessage(null);
      const result = await refreshPortfolioOperatingCadencePhase60Action(
        entityId.trim() || null,
      );
      if (!result.ok) {
        setMessage(result.error);
        setReport(result.report);
        return;
      }
      setReport(result.report);
      setMessage(
        'Portfolio operating cadence refreshed (health, handoffs, subsidiary links).',
      );
      router.refresh();
    });
  }

  function recordRiskMilestone() {
    const title = rmTitle.trim();
    if (title.length < 2) {
      setMessage('Risk / milestone title required.');
      return;
    }
    start(async () => {
      setMessage(null);
      const result = await recordPortfolioRiskMilestonePhase60Action({
        entityId: entityId.trim() || null,
        eventKind: rmKind,
        title,
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setRmTitle('');
      setReport(result.report);
      setMessage('Risk / milestone recorded for weekly cadence.');
      router.refresh();
    });
  }

  function recordPacket() {
    const title = pktTitle.trim();
    if (title.length < 2) {
      setMessage('Review packet title required.');
      return;
    }
    start(async () => {
      setMessage(null);
      const result = await recordPortfolioReviewPacketPhase60Action({
        entityId: entityId.trim() || null,
        packetKind: pktKind,
        title,
        completenessStatus: 'ready',
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setPktTitle('');
      setReport(result.report);
      setMessage('Operating review packet recorded.');
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">
              Portfolio operating cadence · Phase 60
            </CardTitle>
            <CardDescription>
              Weekly Visionary/COO board: company health, risks and milestones,
              review packets, handoff completeness, and company links (Recruit
              619 first; Instant NDA when present).
            </CardDescription>
          </div>
          <Badge variant="secondary" className="font-normal">
            {boardStatusLabel(report.board_status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <label
              htmlFor="p60-entity"
              className="text-xs font-medium text-muted-foreground"
            >
              Company filter
            </label>
            <CompanySelect
              id="p60-entity"
              allowAll
              allLabel="All companies"
              value={entityId}
              onChange={setEntityId}
              className="w-44"
            />
          </div>
          <Button type="button" size="sm" disabled={pending} onClick={runRefresh}>
            {pending ? 'Refreshing…' : 'Refresh board'}
          </Button>
          <Link
            href="/entities/ENT-R619"
            className="text-sm font-medium text-[#3a414f] underline-offset-4 hover:underline"
          >
            Open Recruit 619
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Companies" value={String(report.company_count)} />
          <Metric
            label="Attention required"
            value={String(report.attention_required)}
          />
          <Metric
            label="Missing risks"
            value={String(report.missing_risk_count)}
          />
          <Metric
            label="Missing milestones"
            value={String(report.missing_milestone_count)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="On Track" value={String(report.on_track_count)} />
          <Metric label="Watch" value={String(report.watch_count)} />
          <Metric label="At Risk" value={String(report.at_risk_count)} />
          <Metric label="Critical" value={String(report.critical_count)} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Handoff completeness"
            value={formatCompletenessPct(report.handoff_completeness_pct)}
          />
          <Metric
            label="Handoffs incomplete"
            value={String(report.handoff_incomplete)}
          />
          <Metric
            label="Linked to portfolio"
            value={String(report.linked_to_portfolio)}
          />
          <Metric
            label="Handoff board"
            value={boardStatusLabel(String(report.handoff_board_status))}
          />
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
            Subsidiary linkage
          </p>
          <ul className="space-y-1.5">
            {report.subsidiaries.map((sub) => (
              <li
                key={sub.entity_id}
                className="rounded-md border border-border px-3 py-2 text-xs"
              >
                <span className="font-medium">
                  {entityDisplayName({
                    name: sub.name,
                    entity_id: sub.entity_id,
                  })}
                </span>
                {' · '}
                {boardStatusLabel(String(sub.link_status))}
                {sub.portfolio_id ? ` · linked` : null}
                {sub.todo ? (
                  <span className="block text-muted-foreground">{sub.todo}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>

        {canWrite ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2 rounded-md border border-border p-3">
              <h3 className="text-sm font-medium">Record risk / milestone</h3>
              <select
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                value={rmKind}
                onChange={(e) =>
                  setRmKind(e.target.value as RiskMilestoneKind)
                }
              >
                <option value="risk">Risk</option>
                <option value="milestone">Milestone</option>
                <option value="both">Risk + milestone</option>
              </select>
              <input
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                placeholder="Title"
                value={rmTitle}
                onChange={(e) => setRmTitle(e.target.value)}
              />
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={recordRiskMilestone}
              >
                Record
              </Button>
            </div>
            <div className="space-y-2 rounded-md border border-border p-3">
              <h3 className="text-sm font-medium">Operating review packet</h3>
              <select
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                value={pktKind}
                onChange={(e) =>
                  setPktKind(e.target.value as ReviewPacketKind)
                }
              >
                <option value="weekly_ops">Weekly ops</option>
                <option value="monthly_board">Monthly board</option>
                <option value="subsidiary_deep_dive">
                  Subsidiary deep-dive
                </option>
                <option value="ad_hoc">Ad hoc</option>
              </select>
              <input
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                placeholder="Packet title"
                value={pktTitle}
                onChange={(e) => setPktTitle(e.target.value)}
              />
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={recordPacket}
              >
                Record packet
              </Button>
            </div>
          </div>
        ) : null}

        {report.risks_milestones.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
              Recent risks / milestones
            </p>
            <ul className="space-y-1.5">
              {report.risks_milestones.slice(0, 6).map((row) => (
                <li
                  key={row.event_id}
                  className="rounded-md border border-border px-3 py-2 text-xs"
                >
                  <span className="font-medium">
                    {riskMilestoneLabel(row.event_kind)}
                  </span>
                  {' · '}
                  {row.title}
                  {' · '}
                  {row.status}
                  {row.entity_id
                    ? ` · ${entityDisplayName(row.entity_id)}`
                    : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {report.review_packets.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
              Recent review packets
            </p>
            <ul className="space-y-1.5">
              {report.review_packets.slice(0, 6).map((row) => (
                <li
                  key={row.event_id}
                  className="rounded-md border border-border px-3 py-2 text-xs"
                >
                  <span className="font-medium">
                    {packetKindLabel(row.packet_kind)}
                  </span>
                  {' · '}
                  {row.title}
                  {' · '}
                  {row.period_key}
                  {' · '}
                  {row.completeness_status}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Contract {report.contract_version} · weekly_cadence=
          {String(report.weekly_cadence)}.
          {report.captured_at
            ? ` · Captured ${new Date(report.captured_at).toLocaleString()}`
            : null}
        </p>

        {message ? (
          <p className="text-sm text-emerald-700">{message}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">{report.todo}</p>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-[#3a414f]">{value}</p>
    </div>
  );
}
