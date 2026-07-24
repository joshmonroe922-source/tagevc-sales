import Link from 'next/link';
import { DocuSignHubActions } from '@/components/shared-services/docusign-hub-actions';
import { DocuSignTemplateSendForm } from '@/components/shared-services/docusign-template-send-form';
import { DocuSignReplacementForm } from '@/components/shared-services/docusign-replacement-form';
import { DocuSignManualReview } from '@/components/shared-services/docusign-manual-review';
import { DocuSignMappingReview } from '@/components/shared-services/docusign-mapping-review';
import { LegalHardeningPhase56Client } from '@/components/shared-services/legal-hardening-phase56-client';
import { SscFunctionHomeStrip } from '@/components/shared-services/ssc-function-home-strip';
import { getLegalHardeningPhase56Report } from '@/lib/docusign/legal-hardening-phase56-server';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getDocuSignMode, isDocuSignConfigured } from '@/lib/docusign/config';
import { listRecentEnvelopes } from '@/lib/docusign/envelopes';
import {
  countDocuSignEvents,
  listDocuSignEvents,
} from '@/lib/docusign/events-repo';
import { listSignedFiles } from '@/lib/docusign/signed-docs';
import { listReminderJobs } from '@/lib/docusign/reminder-jobs';
import { listCachedTemplates } from '@/lib/docusign/templates';
import {
  listDocuSignReconciliation,
  listDocuSignReconciliationRuns,
} from '@/lib/docusign/reconciliation-repo';
import { DOCUSIGN_ENV_KEYS } from '@/lib/docusign/types';
import { roleHasPermission } from '@/lib/types/roles';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import { isFirmWideAccess } from '@/lib/rbac/entity-scope';
import {
  listDocuSignManualReviewResolutions,
  listDocuSignSendIntents,
} from '@/lib/docusign/send-intents-repo';
import { listDocuSignMappingReviews } from '@/lib/docusign/mapping-review-repo';
import {
  getArchiveCampaignOpsReport,
  getFirstQuarterlyOpsReport,
  listArchiveCampaigns,
} from '@/lib/docusign/archive-campaigns';
import { getArchivePhase44OpsReport } from '@/lib/docusign/archive-phase44';
import { getArchivePhase45OpsReport } from '@/lib/docusign/archive-phase45';
import { getArchivePhase46OpsReport } from '@/lib/docusign/archive-phase46';
import { getArchivePhase47OpsReport } from '@/lib/docusign/archive-phase47';
import { getArchivePhase48OpsReport } from '@/lib/docusign/archive-phase48';
import { getArchivePhase49OpsReport } from '@/lib/docusign/archive-phase49';
import { getArchivePhase50OpsReport } from '@/lib/docusign/archive-phase50';
import { getArchivePhase51OpsReport } from '@/lib/docusign/archive-phase51';
import { getArchivePhase52OpsReport } from '@/lib/docusign/archive-phase52';
import { listArchiveGovernance } from '@/lib/docusign/archive-governance';

function formatBytes(n: number | null | undefined): string {
  if (n == null || n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function queryHref(
  current: Record<string, string | string[] | undefined>,
  changes: Record<string, string | number | null>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    if (typeof value === 'string' && value) params.set(key, value);
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value == null || value === '') params.delete(key);
    else params.set(key, String(value));
  }
  const query = params.toString();
  return `/shared-services/legal/docusign${query ? `?${query}` : ''}`;
}

export default async function DocuSignModulePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission('read:documents');

  const sp = (await searchParams) ?? {};
  const liveStatusFilter =
    typeof sp.live_status === 'string' ? sp.live_status.trim() : undefined;
  const eventStatusFilter =
    typeof sp.event_status === 'string' ? sp.event_status.trim() : undefined;
  const eventTypeFilter =
    typeof sp.event_type === 'string' ? sp.event_type.trim() : undefined;
  const envelopeFilter =
    typeof sp.envelope_id === 'string' ? sp.envelope_id.trim() : undefined;
  const liveSearch = typeof sp.q === 'string' ? sp.q.trim().toLowerCase() : '';
  const eventSearch =
    typeof sp.event_q === 'string' ? sp.event_q.trim() : undefined;
  const templateSearch =
    typeof sp.template_q === 'string'
      ? sp.template_q.trim().toLowerCase()
      : '';
  const daysRaw = typeof sp.days === 'string' ? Number(sp.days) : 30;
  const liveDays = [7, 30, 60, 90].includes(daysRaw) ? daysRaw : 30;
  const liveStartRaw =
    typeof sp.live_start === 'string' ? Number(sp.live_start) : 0;
  const liveStart =
    Number.isInteger(liveStartRaw) && liveStartRaw >= 0 ? liveStartRaw : 0;
  const templatePageRaw =
    typeof sp.template_page === 'string' ? Number(sp.template_page) : 1;
  const templatePage =
    Number.isInteger(templatePageRaw) && templatePageRaw > 0
      ? templatePageRaw
      : 1;

  const mode = getDocuSignMode();
  const configured = isDocuSignConfigured();
  const ctx = await getSessionContext();
  const canWrite = ctx
    ? roleHasPermission(ctx.profile.role, 'write:documents')
    : false;
  const canReconcile = ctx
    ? roleHasPermission(ctx.profile.role, 'action:docusign_reconcile')
    : false;
  const canArchiveReview = ctx
    ? roleHasPermission(ctx.profile.role, 'action:docusign_manual_review')
    : false;
  const firmWide = ctx
    ? isFirmWideAccess(ctx.profile.role, ctx.profile.entity_id)
    : false;
  const [
    events,
    auditEvents,
    count,
    signed,
    templates,
    reminders,
    liveEnvelopes,
    reconciliation,
    reconciliationRuns,
    sendIntents,
    manualReview,
    mappingReview,
    archiveGovernance,
    archiveCampaigns,
    archiveCampaignOps,
    firstQuarterlyOps,
    phase44Ops,
    phase45Ops,
    phase46Ops,
    phase47Ops,
    phase48Ops,
    phase49Ops,
    phase50Ops,
    phase51Ops,
    phase52Ops,
    phase56Report,
  ] = await Promise.all([
    listDocuSignEvents({
      limit: 40,
      status: eventStatusFilter,
      eventType: eventTypeFilter,
      envelopeId: envelopeFilter,
      search: eventSearch,
    }),
    listDocuSignEvents({ limit: 120 }),
    countDocuSignEvents(),
    listSignedFiles({ limit: 20, withDownloadUrls: true }),
    listCachedTemplates({
      limit: 25,
      offset: (templatePage - 1) * 25,
      search: templateSearch,
    }),
    listReminderJobs(20),
    configured && firmWide
      ? listRecentEnvelopes({
          status: liveStatusFilter,
          count: 100,
          days: liveDays,
          startPosition: liveStart,
        })
      : Promise.resolve({
          ok: true as const,
          envelopes: [],
          pagination: {
            resultSetSize: 0,
            totalSetSize: 0,
            startPosition: 0,
            endPosition: 0,
            nextStartPosition: null,
            previousStartPosition: null,
          },
        }),
    listDocuSignReconciliation({
      limit: 50,
      entityId: ctx?.profile.entity_id ?? null,
      firmWide,
    }),
    firmWide
      ? listDocuSignReconciliationRuns(8)
      : Promise.resolve([]),
    listDocuSignSendIntents({
      entityId: ctx?.profile.entity_id ?? null,
      firmWide,
    }),
    listDocuSignManualReviewResolutions({
      entityId: ctx?.profile.entity_id ?? null,
      firmWide,
    }),
    listDocuSignMappingReviews({
      entityId: ctx?.profile.entity_id ?? null,
      firmWide,
    }),
    listArchiveGovernance({
      entityId: ctx?.profile.entity_id ?? null,
      firmWide,
    }),
    listArchiveCampaigns({ firmWide }),
    getArchiveCampaignOpsReport({ firmWide }),
    getFirstQuarterlyOpsReport({ firmWide }),
    getArchivePhase44OpsReport({ firmWide }),
    getArchivePhase45OpsReport({ firmWide }),
    getArchivePhase46OpsReport({ firmWide }),
    getArchivePhase47OpsReport({ firmWide }),
    getArchivePhase48OpsReport({ firmWide }),
    getArchivePhase49OpsReport({ firmWide }),
    getArchivePhase50OpsReport({ firmWide }),
    getArchivePhase51OpsReport({ firmWide }),
    getArchivePhase52OpsReport({ firmWide }),
    getLegalHardeningPhase56Report({
      entityId: firmWide ? null : (ctx?.profile.entity_id ?? null),
    }),
  ]);

  const voidPolicy = process.env.DOCUSIGN_VOID_POLICY?.trim() || 'allow';
  const canCapital = ctx
    ? roleHasPermission(ctx.profile.role, 'action:docusign_capital')
    : false;

  const missingEnv = DOCUSIGN_ENV_KEYS.filter((k) => {
    if (k === 'DOCUSIGN_OAUTH_HOST' || k === 'DOCUSIGN_BASE_PATH') return false;
    if (k === 'DOCUSIGN_WEBHOOK_SECRET' || k === 'DOCUSIGN_CONNECT_HMAC_SECRET')
      return false;
    return !process.env[k]?.trim();
  });

  if (!firmWide && ctx?.profile.entity_id) {
    signed.rows = signed.rows.filter(
      (row) => row.entity_id === ctx.profile.entity_id,
    );
  }
  const storageOk = signed.rows.filter((r) => r.storage_path).length;
  const storageErr = signed.rows.filter((r) => r.storage_error).length;
  const cocCount = signed.rows.filter((r) => r.file_kind === 'certificate').length;
  const scopedEvents = !firmWide && ctx?.profile.entity_id
    ? events.filter((event) => event.entity_id === ctx.profile.entity_id)
    : events;
  const scopedAuditEvents = !firmWide && ctx?.profile.entity_id
    ? auditEvents.filter((event) => event.entity_id === ctx.profile.entity_id)
    : auditEvents;
  const voidEvents = scopedAuditEvents.filter(
    (e) =>
      e.event_type === 'envelope-voided' ||
      String(e.status).toLowerCase() === 'voided',
  );
  const templateRows = templates.rows;
  const liveRows = liveEnvelopes.ok
    ? liveEnvelopes.envelopes.filter((envelope) => {
        if (!firmWide && ctx?.profile.entity_id) {
          const mapped = reconciliation.find(
            (row) => row.envelope_id === envelope.envelopeId,
          );
          if (mapped?.entity_id !== ctx.profile.entity_id) return false;
        }
        if (!liveSearch) return true;
        return `${envelope.emailSubject ?? ''} ${envelope.envelopeId} ${envelope.recipients
          .map((recipient) => `${recipient.name ?? ''} ${recipient.email ?? ''}`)
          .join(' ')}`
          .toLowerCase()
          .includes(liveSearch);
      })
    : [];
  const replacementLineage = auditEvents.filter((event) =>
    [
      'envelope-replacement-created',
      'envelope-replacement-requested',
      'envelope-replaced',
    ].includes(event.event_type ?? ''),
  );

  return (
    <div className="space-y-6">
      <Link
        href="/shared-services"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Shared Services
      </Link>

      <SscFunctionHomeStrip functionKey="legal" />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Legal</Badge>
          <Badge variant={mode === 'live' ? 'default' : 'secondary'}>
            {mode === 'live' ? 'Live JWT' : 'Mock envelopes'}
          </Badge>
          <Badge variant="secondary">Phase 40</Badge>
          <Badge variant="secondary">Phase 42</Badge>
          <Badge variant="secondary">Phase 44</Badge>
          <Badge variant="secondary">Phase 45</Badge>
          <Badge variant="secondary">Phase 46</Badge>
          <Badge variant="secondary">Phase 47</Badge>
          <Badge variant="secondary">Phase 48</Badge>
          <Badge variant="secondary">Phase 49</Badge>
          <Badge variant="secondary">Phase 50</Badge>
          <Badge variant="secondary">Phase 51</Badge>
          <Badge variant="secondary">Phase 52</Badge>
          <Badge variant="secondary">Phase 56</Badge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">DocuSign</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Replay-safe transactional sends, leased page-by-page reconciliation,
          evidence-verified timeout recovery, independent two-actor send and
          mapping reviews, content-bound archives, and entity-scoped audit
          visibility. Phase 56 hardens template governance, capital dual-control,
          archive integrity, and quarterly process monitoring.
          Void policy: {voidPolicy}. Capital sends still require{' '}
          <code className="text-xs">action:docusign_capital</code>.
        </p>
        <LegalHardeningPhase56Client
          report={phase56Report}
          canWrite={canWrite}
          canCapital={canCapital}
          initialEntityId={
            firmWide ? '' : (ctx?.profile.entity_id ?? '')
          }
        />
        <DocuSignHubActions
          canWrite={canWrite}
          canReconcile={canReconcile}
          canArchiveReview={canArchiveReview}
          firstQuarterlyCtaEligible={
            firmWide && firstQuarterlyOps.cta.eligible
          }
          phase44DriftHealth={
            firmWide ? phase44Ops.report.drift_health : undefined
          }
          phase44BackfillHealth={
            firmWide ? phase44Ops.report.backfill_health : undefined
          }
          phase44AlertDelivery={
            firmWide ? phase44Ops.report.alert_delivery : undefined
          }
          phase45GateProgress={
            firmWide ? phase45Ops.report.gate_clearing_progress : undefined
          }
          phase45DriftBudgetHealth={
            firmWide ? phase45Ops.report.drift_budget_health : undefined
          }
          phase45CadenceHealth={
            firmWide ? phase45Ops.report.cadence_health : undefined
          }
          phase46FirstQuarterlyStatus={
            firmWide ? phase46Ops.report.first_quarterly_status : undefined
          }
          phase46RecurringStatus={
            firmWide ? phase46Ops.report.recurring_quarterly_status : undefined
          }
          phase46CadenceHealth={
            firmWide ? phase46Ops.report.cadence_health : undefined
          }
          phase47RecurringRunStatus={
            firmWide ? phase47Ops.report.recurring_run_status : undefined
          }
          phase47DriftPerformance={
            firmWide ? phase47Ops.report.drift_performance : undefined
          }
          phase48SubsequentRunStatus={
            firmWide ? phase48Ops.report.subsequent_run_status : undefined
          }
          phase48DriftPerformance={
            firmWide ? phase48Ops.report.drift_performance : undefined
          }
          phase49CadenceSloSeverity={
            firmWide ? phase49Ops.report.cadence_slo_severity : undefined
          }
          phase49BudgetProposalStatus={
            firmWide ? phase49Ops.report.budget_proposal_status : undefined
          }
          phase50CadenceTrendDirection={
            firmWide ? phase50Ops.report.cadence_trend_direction : undefined
          }
          phase50PendingReminderCount={
            firmWide
              ? phase50Ops.report.pending_second_approver_reminder_count
              : undefined
          }
          phase51CadenceRollupTrend={
            firmWide
              ? String(
                  phase51Ops.report.cadence_rollup_overall_trend ?? 'unknown',
                )
              : undefined
          }
          phase51PendingEscalatableCount={
            firmWide
              ? phase51Ops.report.pending_third_approver_escalatable_count
              : undefined
          }
          phase52PendingFourthCount={
            firmWide
              ? phase52Ops.report.pending_fourth_approver_count
              : undefined
          }
          phase52ChainThresholdDays={
            firmWide ? phase52Ops.report.chain_threshold_days : undefined
          }
        />
        <DocuSignTemplateSendForm
          templates={templates.rows}
          canWrite={canWrite}
        />
        <DocuSignReplacementForm
          templates={templates.rows}
          voidedEnvelopeIds={liveRows
            .filter((envelope) => envelope.status === 'voided')
            .map((envelope) => envelope.envelopeId)}
          canWrite={canWrite}
        />
        <DocuSignManualReview
          intents={sendIntents.filter(
            (intent) => intent.state === 'manual_review',
          )}
          resolutions={manualReview.resolutions}
          profileId={ctx?.profile.id ?? null}
          canResolve={
            ctx
              ? roleHasPermission(
                  ctx.profile.role,
                  'action:docusign_manual_review',
                )
              : false
          }
        />
        <DocuSignMappingReview
          conflicts={mappingReview.conflicts}
          resolutions={mappingReview.resolutions}
          profileId={ctx?.profile.id ?? null}
          canResolve={
            ctx
              ? roleHasPermission(
                  ctx.profile.role,
                  'action:docusign_manual_review',
                )
              : false
          }
        />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Envelope reconciliation</CardTitle>
            <CardDescription>
              Leased, resumable provider pages are committed atomically with
              immutable evidence. Identity claims are shown separately and
              ambiguities remain quarantined until independent mapping review.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="grid gap-2 sm:grid-cols-4">
              {['in_sync', 'manual_review', 'unmapped_expected', 'retry_wait'].map(
                (state) => (
                  <div className="rounded border p-2" key={state}>
                    <p className="text-muted-foreground">
                      {state.replaceAll('_', ' ')}
                    </p>
                    <p className="text-lg font-semibold">
                      {
                        reconciliation.filter(
                          (row) => row.reconciliation_state === state,
                        ).length
                      }
                    </p>
                  </div>
                ),
              )}
            </div>
            {reconciliation.slice(0, 12).map((row) => (
              <div
                className="flex flex-wrap justify-between gap-2 border-b py-1"
                key={row.envelope_id}
              >
                <span className="font-mono">{row.envelope_id}</span>
                <span>
                  {row.provider_status ?? 'unknown'} /{' '}
                  {row.local_document_status ?? 'unmapped'} ·{' '}
                  {row.reconciliation_state}
                  {row.issue_code ? ` · ${row.issue_code}` : ''}
                </span>
              </div>
            ))}
            {reconciliationRuns.length > 0 ? (
              <p className="text-muted-foreground">
                Latest run: {String(reconciliationRuns[0].status)} ·{' '}
                {String(reconciliationRuns[0].seen)} seen ·{' '}
                {String(reconciliationRuns[0].matched)} matched ·{' '}
                {String(reconciliationRuns[0].manual_review)} review ·{' '}
                {String(reconciliationRuns[0].committed_pages ?? 0)} pages ·
                cursor {String(reconciliationRuns[0].cursor_start_position ?? 0)}
                {reconciliationRuns[0].last_failure_code
                  ? ` · ${String(reconciliationRuns[0].last_failure_code)}`
                  : ''}
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Archive governance</CardTitle>
            <CardDescription>
              Governed legacy backfill and scheduled byte rehashing. Availability
              failures remain distinct from content drift; drift is quarantined
              for manual review. Evidence contains identifiers and hashes only.
              Phase 41 campaigns track backfill completion and quarterly full
              integrity windows. Phase 42 adds ops readiness and quarantine aging
              queue visibility. Phase 43 unlocks the first quarterly when
              backfill is zero and quarantine is aged, with runbook evidence and
              a gated CTA. Phase 44 adds drift/backfill snapshots and integrity
              ops alerts. Phase 45 tracks gate-clearing checklist evidence,
              signed-archive drift budgets, and recurring integrity cadence.
              Phase 46 completes the first quarterly review, arms recurring
              quarterlies, tightens drift budgets from baselines, and improves
              cadence visibility. Phase 47 runs the first armed recurring
              quarterly under tightened drift budgets and reports drift
              performance. Phase 48 schedules subsequent recurring quarterlies,
              tightens budgets on drift breaches, and improves execution
              performance reporting.               Phase 49 tracks a multi-quarter cadence
              SLO and proposes (never silently activates) budget revisions on
              breach — activation requires a distinct dual-human approval.
              Phase 50 adds multi-quarter cadence trend dashboards,
              second-approver reminders for pending budget revision
              proposals, and better recurring quarterly process visibility.
              Phase 51 rolls up firm-wide cadence trends across quarters and
              escalates (never auto-activates) budget proposals whose
              second-approver reminder has gone unanswered too long.
              Phase 52 extends the escalation chain to a fourth approver when
              third-approver escalations age past the chain threshold — still
              never auto-activates budgets.
              Never creates, voids, or resends envelopes.
              {archiveGovernance.error ? ` · ${archiveGovernance.error}` : ''}
              {archiveCampaigns.error ? ` · ${archiveCampaigns.error}` : ''}
              {archiveCampaignOps.error ? ` · ${archiveCampaignOps.error}` : ''}
              {firstQuarterlyOps.error ? ` · ${firstQuarterlyOps.error}` : ''}
              {phase44Ops.error ? ` · ${phase44Ops.error}` : ''}
              {phase45Ops.error ? ` · ${phase45Ops.error}` : ''}
              {phase46Ops.error ? ` · ${phase46Ops.error}` : ''}
              {phase47Ops.error ? ` · ${phase47Ops.error}` : ''}
              {phase48Ops.error ? ` · ${phase48Ops.error}` : ''}
              {phase49Ops.error ? ` · ${phase49Ops.error}` : ''}
              {phase50Ops.error ? ` · ${phase50Ops.error}` : ''}
              {phase51Ops.error ? ` · ${phase51Ops.error}` : ''}
              {phase52Ops.error ? ` · ${phase52Ops.error}` : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {firmWide ? (
              <div className="rounded border border-border/60 bg-muted/30 p-2 space-y-1">
                <p className="font-medium text-foreground">Ops readiness</p>
                <p className="text-muted-foreground">
                  Backfill complete:{' '}
                  {archiveCampaignOps.readiness.backfill_complete ? 'yes' : 'no'}{' '}
                  · Quarterly unlocked:{' '}
                  {archiveCampaignOps.readiness.quarterly_unlocked
                    ? 'yes'
                    : 'no'}{' '}
                  · Ops ready:{' '}
                  {archiveCampaignOps.readiness.ops_ready ? 'yes' : 'no'}
                  {archiveCampaignOps.readiness.quarantine_aging_breach
                    ? ' · aging SLA breach'
                    : ''}
                  {archiveCampaignOps.readiness.quarantine_backlog_high
                    ? ' · backlog gate'
                    : ''}
                </p>
                <p className="text-muted-foreground">
                  Remaining unhashed:{' '}
                  {archiveCampaignOps.readiness.remaining_unhashed} · Quarantine:{' '}
                  {archiveCampaignOps.readiness.quarantine_backlog}
                  {archiveCampaignOps.readiness.quarantine_oldest_days > 0
                    ? ` · oldest ${archiveCampaignOps.readiness.quarantine_oldest_days}d / SLA ${archiveCampaignOps.readiness.aging_sla_days}d`
                    : ''}{' '}
                  · Quarterly due:{' '}
                  {archiveCampaignOps.readiness.quarterly_full_due
                    ? 'yes'
                    : 'no'}
                  {archiveCampaignOps.readiness.first_quarterly_milestone_at
                    ? ` · First quarterly milestone ${new Date(archiveCampaignOps.readiness.first_quarterly_milestone_at).toLocaleString()}`
                    : ' · First quarterly milestone pending'}
                </p>
                <p className="text-muted-foreground">
                  Phase 43 first quarterly:{' '}
                  {firstQuarterlyOps.gates.quarterly_unlocked
                    ? 'unlocked'
                    : 'locked'}
                  {firstQuarterlyOps.gates.quarantine_aged
                    ? ' · quarantine aged'
                    : ' · quarantine aging pending'}
                  {firstQuarterlyOps.cta.eligible
                    ? ' · CTA ready'
                    : firstQuarterlyOps.gates.first_quarterly_completed
                      ? ' · first quarterly complete'
                      : ''}
                  {firstQuarterlyOps.gates.unlock_recorded
                    ? ' · unlock recorded'
                    : ''}
                  {firstQuarterlyOps.gates.runbook_ack_recorded
                    ? ' · runbook ack'
                    : ''}
                </p>
                <p className="text-muted-foreground">
                  Phase 44 health: drift {phase44Ops.report.drift_health} ·
                  backfill {phase44Ops.report.backfill_health} · alerts{' '}
                  {phase44Ops.report.alert_delivery}
                  {phase44Ops.report.critical_alert_count > 0
                    ? ` (${phase44Ops.report.critical_alert_count})`
                    : ''}
                  {phase44Ops.report.latest_backfill?.completeness_pct != null
                    ? ` · completeness ${String(phase44Ops.report.latest_backfill.completeness_pct)}%`
                    : ''}
                </p>
                <p className="text-muted-foreground">
                  Phase 45 gate:{' '}
                  {phase45Ops.report.gate_clearing_progress} (
                  {phase45Ops.report.steps_cleared}/
                  {phase45Ops.report.steps_total}) · drift budget{' '}
                  {phase45Ops.report.drift_budget_health} · cadence{' '}
                  {phase45Ops.report.cadence_health}
                  {phase45Ops.report.recurring_quarterly_armed
                    ? ' · recurring armed'
                    : phase45Ops.report.first_quarterly_ready
                      ? ' · first quarterly ready'
                      : ''}
                  {phase45Ops.report.latest_cadence?.sample_overdue
                    ? ' · sample overdue'
                    : ''}
                  {phase45Ops.report.latest_cadence?.full_overdue
                    ? ' · full overdue'
                    : ''}
                </p>
                <p className="text-muted-foreground">
                  Phase 46 first quarterly:{' '}
                  {phase46Ops.report.first_quarterly_status} · recurring{' '}
                  {phase46Ops.report.recurring_quarterly_status} · drift
                  revision {phase46Ops.report.drift_revision_status} · cadence{' '}
                  {phase46Ops.report.cadence_health}
                  {phase46Ops.report.latest_arm?.next_due
                    ? ` · next due ${new Date(String(phase46Ops.report.latest_arm.next_due)).toLocaleString()}`
                    : ''}
                  {phase46Ops.report.latest_cadence?.quarterly_overdue
                    ? ' · quarterly overdue'
                    : ''}
                </p>
                <p className="text-muted-foreground">
                  Phase 47 recurring run:{' '}
                  {phase47Ops.report.recurring_run_status} · drift{' '}
                  {phase47Ops.report.drift_performance}
                  {phase47Ops.report.first_recurring_completed
                    ? ' · first recurring complete'
                    : ''}
                  {phase47Ops.report.tightened_budget_active
                    ? ' · tightened budget active'
                    : ''}
                  {phase47Ops.report.latest_run?.content_drift_count != null
                    ? ` · drift ${String(phase47Ops.report.latest_run.content_drift_count)}/${String(phase47Ops.report.latest_run.max_content_drift_per_window ?? '?')}`
                    : ''}
                </p>
                <p className="text-muted-foreground">
                  Phase 48 subsequent:{' '}
                  {phase48Ops.report.subsequent_run_status} · schedule{' '}
                  {phase48Ops.report.schedule_status} · drift{' '}
                  {phase48Ops.report.drift_performance} · breach tighten{' '}
                  {phase48Ops.report.breach_tighten_status}
                  {phase48Ops.report.completed_subsequent_count > 0
                    ? ` · completed ${phase48Ops.report.completed_subsequent_count}`
                    : ''}
                  {phase48Ops.report.breach_count_30d > 0
                    ? ` · breaches 30d ${phase48Ops.report.breach_count_30d}`
                    : ''}
                  {phase48Ops.report.latest_schedule?.due_at
                    ? ` · next due ${new Date(String(phase48Ops.report.latest_schedule.due_at)).toLocaleString()}`
                    : ''}
                </p>
                <p className="text-muted-foreground">
                  Phase 49 cadence SLO:{' '}
                  {phase49Ops.report.cadence_slo_severity}
                  {phase49Ops.report.cadence_on_time_rate != null
                    ? ` (${Math.round(phase49Ops.report.cadence_on_time_rate * 100)}% on-time)`
                    : ''}
                  {' · '}budget proposal{' '}
                  {phase49Ops.report.budget_proposal_status}
                  {phase49Ops.report.pending_proposal_count > 0
                    ? ` · pending ${phase49Ops.report.pending_proposal_count}`
                    : ''}
                  {phase49Ops.report.activated_proposal_count > 0
                    ? ` · activated ${phase49Ops.report.activated_proposal_count}`
                    : ''}
                </p>
                <p className="text-muted-foreground">
                  Phase 50 cadence trend:{' '}
                  {phase50Ops.report.cadence_trend_direction}
                  {phase50Ops.report.cadence_consecutive_healthy_snapshots > 0
                    ? ` (${phase50Ops.report.cadence_consecutive_healthy_snapshots} healthy)`
                    : ''}
                  {' · '}recurring process{' '}
                  {phase50Ops.report.recurring_process_health}
                  {phase50Ops.report.pending_second_approver_reminder_count > 0
                    ? ` · awaiting 2nd approver ${phase50Ops.report.pending_second_approver_reminder_count}`
                    : ''}
                  {phase50Ops.report.reminders_sent_7d > 0
                    ? ` · reminders sent 7d ${phase50Ops.report.reminders_sent_7d}`
                    : ''}
                </p>
                <p className="text-muted-foreground">
                  Phase 51 firm-wide cadence rollup:{' '}
                  {phase51Ops.report.cadence_rollup_overall_trend}
                  {phase51Ops.report.cadence_rollup_snapshots_compared > 0
                    ? ` (${phase51Ops.report.cadence_rollup_snapshots_compared} compared)`
                    : ''}
                  {phase51Ops.report.pending_third_approver_escalatable_count > 0
                    ? ` · 3rd-approver escalatable ${phase51Ops.report.pending_third_approver_escalatable_count}`
                    : ''}
                  {phase51Ops.report.third_approver_escalations_7d > 0
                    ? ` · escalations 7d ${phase51Ops.report.third_approver_escalations_7d}`
                    : ''}
                  {' · never activates budgets silently'}
                </p>
                <p className="text-muted-foreground">
                  Phase 52 fourth-approver escalation chain:{' '}
                  {phase52Ops.report.chain_active ? 'active' : 'idle'}
                  {phase52Ops.report.chain_threshold_days > 0
                    ? ` · threshold ${phase52Ops.report.chain_threshold_days}d`
                    : ''}
                  {phase52Ops.report.pending_fourth_approver_count > 0
                    ? ` · pending 4th-approver ${phase52Ops.report.pending_fourth_approver_count}`
                    : ''}
                  {phase52Ops.report.fourth_approver_escalations_7d > 0
                    ? ` · escalations 7d ${phase52Ops.report.fourth_approver_escalations_7d}`
                    : ''}
                  {' · never activates budgets silently'}
                </p>
              </div>
            ) : null}
            {firmWide ? (
              <p className="text-muted-foreground">
                Remaining unhashed: {archiveCampaigns.live.remaining_unhashed} ·
                Quarantine backlog:{' '}
                {archiveCampaigns.live.quarantine_backlog}
                {archiveCampaigns.live.quarantine_oldest_days > 0
                  ? ` · oldest ${archiveCampaigns.live.quarantine_oldest_days}d`
                  : ''}{' '}
                · Quarterly due:{' '}
                {archiveCampaigns.live.quarterly_full_due ? 'yes' : 'no'}
                {archiveCampaigns.lastFullScanAt
                  ? ` · Last full scan ${new Date(archiveCampaigns.lastFullScanAt).toLocaleString()}`
                  : ' · No completed full scan yet'}
              </p>
            ) : null}
            {firmWide && archiveCampaigns.campaigns.length > 0
              ? archiveCampaigns.campaigns.slice(0, 4).map((camp) => (
                  <div
                    className="flex flex-wrap justify-between gap-2 border-b py-1"
                    key={String(camp.campaign_id)}
                  >
                    <span>
                      {String(camp.campaign_kind).replaceAll('_', ' ')}
                      {camp.gate_blocked
                        ? ` · gated (${String(camp.gate_reason ?? 'gate')})`
                        : ''}
                    </span>
                    <span>
                      {String(camp.status)} · {String(camp.progress_pct)}% ·{' '}
                      {String(camp.gate_remaining_unhashed)} remaining ·{' '}
                      {String(camp.linked_run_count)} runs
                    </span>
                  </div>
                ))
              : null}
            {firmWide && firstQuarterlyOps.runbook.length > 0 ? (
              <div className="space-y-1">
                <p className="text-muted-foreground">
                  First quarterly runbook evidence
                </p>
                {firstQuarterlyOps.runbook.slice(0, 4).map((row) => (
                  <div
                    className="flex flex-wrap justify-between gap-2 border-b py-1"
                    key={String(row.evidence_id)}
                  >
                    <span>
                      {String(row.step_kind).replaceAll('_', ' ')}
                      {row.gates_unlocked ? ' · unlocked' : ''}
                      {row.cta_eligible ? ' · CTA' : ''}
                    </span>
                    <span>
                      {row.created_at
                        ? new Date(String(row.created_at)).toLocaleString()
                        : '—'}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {firmWide && archiveCampaignOps.milestones.length > 0 ? (
              <div className="space-y-1">
                <p className="text-muted-foreground">Recent ops milestones</p>
                {archiveCampaignOps.milestones.slice(0, 4).map((milestone) => (
                  <div
                    className="flex flex-wrap justify-between gap-2 border-b py-1"
                    key={String(milestone.event_id)}
                  >
                    <span>
                      {String(milestone.event_kind).replaceAll('_', ' ')}
                    </span>
                    <span>
                      {milestone.created_at
                        ? new Date(
                            String(milestone.created_at),
                          ).toLocaleString()
                        : '—'}{' '}
                      · {String(milestone.progress_pct ?? 0)}%
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {firmWide && archiveGovernance.runs.length > 0 ? (
              archiveGovernance.runs.slice(0, 6).map((run) => (
                <div
                  className="flex flex-wrap justify-between gap-2 border-b py-1"
                  key={String(run.run_id)}
                >
                  <span>
                    {String(run.run_kind).replaceAll('_', ' ')} ·{' '}
                    {String(run.scan_mode)}
                  </span>
                  <span>
                    {String(run.status)} · {String(run.succeeded_count)} ok ·{' '}
                    {String(run.unavailable_count)} unavailable ·{' '}
                    {String(run.drift_count)} drift · invocation{' '}
                    {String(run.invocation_count)}
                  </span>
                </div>
              ))
            ) : firmWide ? (
              <p className="text-muted-foreground">No archive governance runs yet.</p>
            ) : null}
            <p className="text-muted-foreground">
              Open quarantine: {' '}
              {
                archiveGovernance.quarantines.filter(
                  (row) => row.status === 'manual_review',
                ).length
              }
              {firmWide
                ? ` · Aging queue: ${archiveCampaignOps.agingQueue.length}`
                : ''}
            </p>
            {firmWide && archiveCampaignOps.agingQueue.length > 0 ? (
              <div className="space-y-1">
                <p className="text-muted-foreground">
                  Quarantine aging queue (oldest first by opened_at)
                </p>
                {archiveCampaignOps.agingQueue.slice(0, 8).map((row) => (
                  <div
                    className="flex flex-wrap justify-between gap-2 border-b py-1"
                    key={row.quarantine_id}
                  >
                    <span className="font-mono">
                      {row.envelope_id.slice(0, 18)} · {row.file_kind}
                      <span className="block text-muted-foreground">
                        {row.quarantine_id} · version {row.row_version} · bucket{' '}
                        {row.age_bucket}
                      </span>
                    </span>
                    <span
                      className={
                        row.age_days > 45
                          ? 'text-amber-800'
                          : 'text-amber-700'
                      }
                    >
                      {row.age_days}d · {row.reason_code}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {archiveGovernance.quarantines.slice(0, 8).map((row) => (
              <div
                className="flex flex-wrap justify-between gap-2 border-b py-1"
                key={String(row.quarantine_id)}
              >
                <span className="font-mono">
                  {String(row.envelope_id).slice(0, 18)} · {String(row.file_kind)}
                  <span className="block text-muted-foreground">
                    {String(row.quarantine_id)} · version {String(row.row_version)}
                  </span>
                </span>
                <span className="text-amber-700">
                  {String(row.status)} · {String(row.reason_code)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Transactional send intents</CardTitle>
            <CardDescription>
              Provider transaction IDs make retries and timeout recovery
              idempotent before an envelope ID exists.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            {sendIntents.length === 0 ? (
              <p className="text-muted-foreground">No transactional sends yet.</p>
            ) : (
              sendIntents.slice(0, 12).map((intent) => (
                <div
                  className="flex flex-wrap justify-between gap-2 border-b py-1"
                  key={String(intent.intent_id)}
                >
                  <span>
                    {String(intent.operation_kind)} ·{' '}
                    {String(intent.doc_id ?? intent.template_id ?? 'template')}
                  </span>
                  <span>
                    {String(intent.state)} · dispatch{' '}
                    {String(intent.dispatch_attempts)} · recovery{' '}
                    {String(intent.recovery_attempts)}
                    {intent.last_error_code
                      ? ` · ${String(intent.last_error_code)}`
                      : ''}
                    {intent.last_lookup_disposition
                      ? ` · ${String(intent.last_lookup_disposition)}`
                      : ''}
                    {intent.candidate_envelope_id
                      ? ` · candidate ${String(intent.candidate_envelope_id)}`
                      : ''}
                    {intent.manual_review_reason
                      ? ` · ${String(intent.manual_review_reason)}`
                      : ''}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Integration status</CardTitle>
            <CardDescription>
              Mode: <strong>{mode}</strong>
              {count !== null ? ` · ${count} events logged` : ' · events table unavailable'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              JWT configured:{' '}
              <span className={configured ? 'text-emerald-700' : ''}>
                {configured ? 'yes' : 'no — falling back to mock ENV- ids'}
              </span>
            </p>
            {!configured && missingEnv.length > 0 && (
              <p className="text-muted-foreground">
                Missing: {missingEnv.join(', ')}
              </p>
            )}
            <p className="text-muted-foreground">
              Webhook: <code className="text-xs">POST /api/docusign/webhook</code>
            </p>
            <p className="text-muted-foreground">
              Object storage: {storageOk} in bucket · CoC rows: {cocCount}
              {storageErr > 0 ? (
                <span className="text-amber-700"> · {storageErr} with errors</span>
              ) : null}
            </p>
            <Link
              href="/documents"
              className="inline-flex text-sm font-medium underline-offset-4 hover:underline"
            >
              Open Documents →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Links</CardTitle>
            <CardDescription>
              Apply <code className="text-xs">phase29_paid_media_warranty.sql</code>{' '}
              for paid campaign stubs and warranty.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1">
            <p>
              Docs: <code className="text-xs">docs/OS_DOCUSIGN.md</code>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Templates</CardTitle>
          <CardDescription>
            Cached from DocuSign account — use Refresh templates to sync
            {templates.error ? ` · ${templates.error}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form className="flex flex-wrap gap-2">
            <input type="hidden" name="template_page" value="1" />
            <input
              name="template_q"
              defaultValue={templateSearch}
              placeholder="Search name, description, or ID"
              className="min-w-64 rounded-md border bg-background px-3 py-1.5 text-sm"
            />
            <button className="rounded-md border px-3 py-1.5 text-sm" type="submit">
              Search templates
            </button>
          </form>
          {templateRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No templates cached yet — configure JWT and click Refresh templates.
            </p>
          ) : (
            <ul className="space-y-1 text-sm max-h-48 overflow-y-auto">
              {templateRows.map((t) => (
                <li
                  key={t.template_id}
                  className="border-b border-border/40 py-1.5"
                >
                  <span className="font-medium">{t.name}</span>
                  {t.shared ? (
                    <span className="ml-1 text-xs text-muted-foreground">shared</span>
                  ) : null}
                  <span className="block font-mono text-xs text-muted-foreground">
                    {t.template_id}
                    {t.last_modified
                      ? ` · ${t.last_modified.slice(0, 10)}`
                      : ''}
                  </span>
                  {t.roles?.length ? (
                    <span className="block text-xs text-muted-foreground">
                      Roles: {t.roles.join(', ')}
                    </span>
                  ) : null}
                  <span className="block text-xs text-muted-foreground">
                    Synced {t.synced_at.slice(0, 16).replace('T', ' ')}
                    {Date.now() - Date.parse(t.synced_at) > 86_400_000
                      ? ' · stale'
                      : ' · fresh'}
                    {t.description ? ` · ${t.description}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Page {templatePage} · {templates.count} cached templates
            </span>
            <span className="flex gap-2">
              {templatePage > 1 ? (
                <Link
                  href={queryHref(sp, {
                    template_page: templatePage - 1,
                  })}
                  className="underline-offset-4 hover:underline"
                >
                  Previous
                </Link>
              ) : null}
              {templatePage * 25 < templates.count ? (
                <Link
                  href={queryHref(sp, {
                    template_page: templatePage + 1,
                  })}
                  className="underline-offset-4 hover:underline"
                >
                  Next
                </Link>
              ) : null}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Replacement lineage</CardTitle>
          <CardDescription>
            Intent and reciprocal links between voided and replacement envelopes
          </CardDescription>
        </CardHeader>
        <CardContent>
          {replacementLineage.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No replacement lineage logged yet.
            </p>
          ) : (
            <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
              {replacementLineage.slice(0, 20).map((event) => {
                const raw = (event.raw_payload ?? {}) as {
                  replacement_for_envelope_id?: string;
                  replaced_by_envelope_id?: string;
                  templateId?: string;
                  actor_email?: string;
                };
                const related =
                  raw.replacement_for_envelope_id ??
                  raw.replaced_by_envelope_id;
                return (
                  <li
                    key={event.event_id}
                    className="border-b border-border/40 py-1.5"
                  >
                    <span className="font-mono text-xs">{event.envelope_id}</span>
                    {' · '}
                    {event.event_type}
                    {related ? (
                      <span className="block font-mono text-xs text-muted-foreground">
                        Related: {related}
                        {raw.templateId ? ` · template ${raw.templateId}` : ''}
                        {raw.actor_email ? ` · ${raw.actor_email}` : ''}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Live envelopes</CardTitle>
          <CardDescription>
            Authoritative DocuSign status changes from the selected window
            {!liveEnvelopes.ok ? ` · ${liveEnvelopes.error}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form className="flex flex-wrap gap-2 text-xs">
            <input type="hidden" name="live_start" value="0" />
            <input
              name="q"
              defaultValue={liveSearch}
              placeholder="Subject, ID, recipient"
              className="min-w-56 rounded-md border bg-background px-2 py-1"
            />
            <select
              name="live_status"
              defaultValue={liveStatusFilter || ''}
              className="rounded-md border bg-background px-2 py-1"
            >
              <option value="">All statuses</option>
              {['sent', 'delivered', 'completed', 'voided'].map((status) => (
                <option value={status} key={status}>{status}</option>
              ))}
            </select>
            <select
              name="days"
              defaultValue={String(liveDays)}
              className="rounded-md border bg-background px-2 py-1"
            >
              {[7, 30, 60, 90].map((days) => (
                <option value={days} key={days}>{days} days</option>
              ))}
            </select>
            <button className="rounded-md border px-2 py-1" type="submit">
              Apply
            </button>
          </form>
          <div className="flex flex-wrap gap-2 text-xs">
            {['all', 'sent', 'delivered', 'completed', 'voided'].map((s) => (
              <Link
                key={s}
                href={
                  queryHref(sp, {
                    live_status: s === 'all' ? null : s,
                    live_start: 0,
                  })
                }
                className="rounded-full border px-2 py-1 underline-offset-4 hover:underline"
              >
                {s}
              </Link>
            ))}
          </div>
          {liveEnvelopes.ok && liveRows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 pr-3">Subject</th>
                    <th className="py-2 pr-3">Envelope</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2">Changed</th>
                  </tr>
                </thead>
                <tbody>
                  {liveRows.map((e) => (
                    <tr
                      key={e.envelopeId}
                      className="border-b border-border/40"
                    >
                      <td className="py-2 pr-3">
                        {e.emailSubject ?? 'Untitled'}
                        {e.voidedReason ? (
                          <span className="block text-xs text-amber-700">
                            Void: {e.voidedReason}
                          </span>
                        ) : null}
                        {e.recipients.length > 0 ? (
                          <span className="block text-xs text-muted-foreground">
                            {e.recipients
                              .map(
                                (recipient) =>
                                  `${recipient.name ?? recipient.email ?? recipient.role}: ${recipient.status}`,
                              )
                              .join(' · ')}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        <Link
                          href={`/shared-services/legal/docusign?envelope_id=${encodeURIComponent(e.envelopeId)}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {e.envelopeId.slice(0, 18)}
                          {e.envelopeId.length > 18 ? '…' : ''}
                        </Link>
                      </td>
                      <td
                        className={`py-2 pr-3 ${
                          e.status === 'voided'
                            ? 'text-amber-700'
                            : e.status === 'completed'
                              ? 'text-emerald-700'
                              : ''
                        }`}
                      >
                        {e.status}
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {e.statusChangedDateTime
                          ?.slice(0, 16)
                          .replace('T', ' ') ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {configured
                ? `No matching live envelopes in the last ${liveDays} days.`
                : 'Configure DocuSign JWT to load live envelopes.'}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Voids cannot be undone in DocuSign. Use “Replace voided envelope”
            to create a new envelope with audit lineage.
          </p>
          {liveEnvelopes.ok ? (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {liveEnvelopes.pagination.totalSetSize === 0
                  ? '0 results'
                  : `${liveEnvelopes.pagination.startPosition + 1}–${
                      liveEnvelopes.pagination.endPosition + 1
                    } of ${liveEnvelopes.pagination.totalSetSize}`}
              </span>
              <span className="flex gap-2">
                {liveEnvelopes.pagination.previousStartPosition != null ? (
                  <Link
                    href={queryHref(sp, {
                      live_start:
                        liveEnvelopes.pagination.previousStartPosition,
                    })}
                    className="underline-offset-4 hover:underline"
                  >
                    Previous
                  </Link>
                ) : null}
                {liveEnvelopes.pagination.nextStartPosition != null ? (
                  <Link
                    href={queryHref(sp, {
                      live_start: liveEnvelopes.pagination.nextStartPosition,
                    })}
                    className="underline-offset-4 hover:underline"
                  >
                    Next
                  </Link>
                ) : null}
              </span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reminder queue</CardTitle>
          <CardDescription>
            Scheduled +1/+3/+7d reminders (daily worker)
            {reminders.error ? ` · ${reminders.error}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {reminders.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Empty — schedule reminders from an envelope or template send.
            </p>
          ) : (
            <ul className="space-y-1 text-sm max-h-40 overflow-y-auto text-muted-foreground">
              {reminders.rows.map((j) => (
                <li key={j.job_id}>
                  <span
                    className={
                      j.status === 'pending'
                        ? 'text-amber-700'
                        : j.status === 'failed'
                          ? 'text-destructive'
                          : j.status === 'succeeded'
                            ? 'text-emerald-700'
                            : undefined
                    }
                  >
                    {j.status}
                  </span>
                  {' · '}
                  {j.scheduled_for.slice(0, 16).replace('T', ' ')} ·{' '}
                  {j.envelope_id.slice(0, 16)}…
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Void audit</CardTitle>
          <CardDescription>
            Recent envelope-voided events (reason + actor in payload)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {voidEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No voids logged yet.</p>
          ) : (
            <ul className="space-y-1 text-sm max-h-40 overflow-y-auto">
              {voidEvents.slice(0, 10).map((e) => {
                const raw = (e.raw_payload ?? {}) as {
                  reason?: string;
                  actor_email?: string;
                };
                return (
                  <li
                    key={e.event_id ?? `${e.envelope_id}-${e.received_at}`}
                    className="border-b border-border/40 py-1.5"
                  >
                    <span className="font-mono text-xs">
                      {e.envelope_id.slice(0, 16)}…
                    </span>
                    {' · '}
                    {e.received_at?.slice(0, 16).replace('T', ' ')}
                    {raw.reason ? (
                      <span className="block text-xs text-muted-foreground">
                        {raw.reason}
                        {raw.actor_email ? ` · ${raw.actor_email}` : ''}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent events</CardTitle>
          <CardDescription>
            From <code className="text-xs">os_docusign_events</code> (newest first)
            {(eventStatusFilter ||
              eventTypeFilter ||
              envelopeFilter ||
              eventSearch) &&
              ' · filtered'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <form className="flex flex-wrap gap-2">
              <input
                name="event_q"
                defaultValue={eventSearch}
                placeholder="Envelope, document, entity, deal, ticket"
                className="min-w-64 rounded-md border bg-background px-2 py-1"
              />
              <button type="submit" className="rounded-md border px-2 py-1">
                Search events
              </button>
            </form>
            <Link
              href="/shared-services/legal/docusign"
              className="underline-offset-4 hover:underline"
            >
              All
            </Link>
            <Link
              href="/shared-services/legal/docusign?event_status=voided"
              className="underline-offset-4 hover:underline"
            >
              Voided
            </Link>
            <Link
              href="/shared-services/legal/docusign?event_status=completed"
              className="underline-offset-4 hover:underline"
            >
              Completed
            </Link>
            <Link
              href="/shared-services/legal/docusign?event_status=sent"
              className="underline-offset-4 hover:underline"
            >
              Sent
            </Link>
            <Link
              href="/shared-services/legal/docusign?event_type=envelope-voided"
              className="underline-offset-4 hover:underline"
            >
              Void events
            </Link>
            <Link
              href="/shared-services/legal/docusign?event_type=envelope-sent-from-template"
              className="underline-offset-4 hover:underline"
            >
              Template sends
            </Link>
          </div>
          {scopedEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No events yet — send a document or wait for Connect.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 pr-3 font-medium">When</th>
                    <th className="py-2 pr-3 font-medium">Envelope</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Event</th>
                    <th className="py-2 pr-3 font-medium">Doc</th>
                    <th className="py-2 pr-3 font-medium">Entity</th>
                    <th className="py-2 font-medium">Deal / Ticket</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedEvents.map((e) => (
                    <tr key={e.id} className="border-b border-border/40">
                      <td className="py-2 pr-3 whitespace-nowrap text-xs text-muted-foreground">
                        {e.received_at.slice(0, 19).replace('T', ' ')}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        {e.envelope_id.slice(0, 18)}
                        {e.envelope_id.length > 18 ? '…' : ''}
                      </td>
                      <td
                        className={`py-2 pr-3 ${
                          e.status === 'voided' ? 'text-amber-700' : ''
                        }`}
                      >
                        {e.status}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {e.event_type ?? '—'}
                      </td>
                      <td className="py-2 pr-3">
                        {e.doc_id ? (
                          <Link
                            href={`/documents/${e.doc_id}`}
                            className="underline-offset-4 hover:underline"
                          >
                            {e.doc_id}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2 pr-3">{e.entity_id ?? '—'}</td>
                      <td className="py-2 text-xs">
                        {e.deal_id || e.ticket_id || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Signed archives + CoC</CardTitle>
          <CardDescription>
            Combined PDFs and Certificates of Completion in{' '}
            <code className="text-xs">docusign-signed</code>
            {signed.error ? ` · ${signed.error}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {signed.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No signed files yet — complete an envelope via Connect or simulate.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 pr-3 font-medium">File</th>
                    <th className="py-2 pr-3 font-medium">Kind</th>
                    <th className="py-2 pr-3 font-medium">Size</th>
                    <th className="py-2 pr-3 font-medium">Storage</th>
                    <th className="py-2 font-medium">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {signed.rows.map((row) => (
                    <tr key={row.id} className="border-b border-border/40">
                      <td className="py-2 pr-3">
                        <span className="font-medium">{row.file_name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {row.source} · {row.library_path ?? '—'} ·{' '}
                          {row.envelope_id.slice(0, 16)}…
                        </span>
                        {row.content_sha256 ? (
                          <span className="block font-mono text-xs text-muted-foreground">
                            SHA-256 {row.content_sha256.slice(0, 16)}…
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {row.file_kind ?? 'combined'}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {formatBytes(row.size_bytes)}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {row.storage_path ? (
                          <span className="text-emerald-700">object</span>
                        ) : row.storage_error ? (
                          <span className="text-amber-700" title={row.storage_error}>
                            error
                          </span>
                        ) : (
                          <span className="text-muted-foreground">inline/legacy</span>
                        )}
                        {row.storage_error ? (
                          <span className="block text-amber-700/90 max-w-[14rem] truncate">
                            {row.storage_error}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 text-xs">
                        {row.download_url ? (
                          <a
                            href={row.download_url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            Download
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
