'use client';

import { useActionState, useState, useTransition } from 'react';
import {
  assignHardwareAction,
  completeOffboardingAction,
  createHardwareAction,
  createLicenseAction,
  executeOffboardingAction,
  grantSeatAction,
  returnHardwareAction,
  revokeSeatAction,
  startOffboardingAction,
  startOffboardingFromTicketAction,
  scanInactiveOffboardingAction,
  startOnboardingAction,
  executeOnboardingAction,
  completeOnboardingAction,
  startOnboardingFromTicketAction,
  scanActiveOnboardingAction,
  scanLicenseRenewalsAction,
  bulkUpdateWarrantyAction,
  commitWarrantyImportAction,
  approveIntuneActionAction,
  matchIntuneActionAction,
  cancelIntuneActionAction,
  retryIntuneActionAction,
  proposeIntuneAmbiguityResolutionAction,
  proposeIntuneBreakerResetAction,
  proposeIntuneBreakerTuningAction,
  reviewIntuneAmbiguityResolutionAction,
  reviewIntuneBreakerResetAction,
  reviewIntuneBreakerTuningAction,
  runIntuneWorkerAction,
  type ItAssetActionResult,
} from '@/app/(app)/shared-services/it/assets/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { OffboardingRun } from '@/lib/shared-services/it-offboarding';
import type { OnboardingRun } from '@/lib/shared-services/it-onboarding';
import type {
  ItAssignmentEvent,
  ItHardwareAsset,
  ItSoftwareLicense,
} from '@/lib/shared-services/it-assets-types';
import type {
  ItIntuneAction,
  ItIntuneAmbiguityResolution,
  ItIntuneBreakerHealth,
  ItIntuneBreakerResetProposal,
  ItIntunePhase40Health,
  ItIntuneTuningProposal,
  ItLifecycleEvent,
} from '@/lib/shared-services/it-assets-repo';

function ActionMessage({ state }: { state: ItAssetActionResult | null }) {
  if (!state) return null;
  if (state.ok) {
    return (
      <p className="text-sm text-emerald-700">{state.message ?? 'Done'}</p>
    );
  }
  return <p className="text-sm text-destructive">{state.error}</p>;
}

function upcomingLicenseRenewals(
  licenses: ItSoftwareLicense[],
  withinDays = 30,
): ItSoftwareLicense[] {
  const horizon = Date.now() + withinDays * 86_400_000;
  return licenses
    .filter((license) => {
      if (!license.renewal_date) return false;
      if (license.status !== 'active' && license.status !== 'pending') {
        return false;
      }
      const due = Date.parse(license.renewal_date);
      return !Number.isNaN(due) && due <= horizon;
    })
    .sort((a, b) =>
      String(a.renewal_date).localeCompare(String(b.renewal_date)),
    );
}

export function ItAssetsClient({
  hardware,
  licenses,
  events,
  lifecycleEvents = [],
  offboarding,
  onboarding = [],
  candidateTickets,
  onboardingTickets = [],
  intuneActions = [],
  intuneEvents = [],
  intuneDispatchAttempts = [],
  intuneWorkerRuns = [],
  intuneAmbiguityResolutions = [],
  intuneManualReviewSlo = [],
  intuneBreakerHealth = [],
  intuneBreakerResetProposals = [],
  intuneTuningProposals = [],
  intunePhase40Health = null,
  canIntuneRetire = false,
  canIntuneManualReview = false,
  currentActorId = null,
  canWrite,
  tableError,
}: {
  hardware: ItHardwareAsset[];
  licenses: ItSoftwareLicense[];
  events: ItAssignmentEvent[];
  lifecycleEvents?: ItLifecycleEvent[];
  offboarding: OffboardingRun[];
  onboarding?: OnboardingRun[];
  candidateTickets: Array<{
    ticket_id: string;
    title: string;
    service: string;
    status: string;
  }>;
  onboardingTickets?: Array<{
    ticket_id: string;
    title: string;
    service: string;
    status: string;
  }>;
  intuneActions?: ItIntuneAction[];
  intuneEvents?: Array<Record<string, unknown>>;
  intuneDispatchAttempts?: Array<Record<string, unknown>>;
  intuneWorkerRuns?: Array<Record<string, unknown>>;
  intuneAmbiguityResolutions?: ItIntuneAmbiguityResolution[];
  intuneManualReviewSlo?: Array<Record<string, unknown>>;
  intuneBreakerHealth?: ItIntuneBreakerHealth[];
  intuneBreakerResetProposals?: ItIntuneBreakerResetProposal[];
  intuneTuningProposals?: ItIntuneTuningProposal[];
  intunePhase40Health?: ItIntunePhase40Health | null;
  canIntuneRetire?: boolean;
  canIntuneManualReview?: boolean;
  currentActorId?: string | null;
  canWrite: boolean;
  tableError?: string;
}) {
  const [hwState, hwAction, hwPending] = useActionState(
    createHardwareAction,
    null as ItAssetActionResult | null,
  );
  const [warrantyState, warrantyAction, warrantyPending] = useActionState(
    bulkUpdateWarrantyAction,
    null as ItAssetActionResult | null,
  );
  const [warrantyCommitState, warrantyCommitAction, warrantyCommitPending] =
    useActionState(
      commitWarrantyImportAction,
      null as ItAssetActionResult | null,
    );
  const [licState, licAction, licPending] = useActionState(
    createLicenseAction,
    null as ItAssetActionResult | null,
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(
    fn: () => Promise<ItAssetActionResult>,
  ) {
    setMsg(null);
    setErr(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) setMsg(res.message ?? 'Done');
      else setErr(res.error);
    });
  }

  const renewals = upcomingLicenseRenewals(licenses, 30);

  return (
    <div className="space-y-8">
      {tableError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Tables unavailable — apply phase20–26 IT SQL. {tableError}
        </p>
      )}
      {renewals.length > 0 && (
        <div className="rounded-md border border-amber-600/40 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p className="font-medium">
            {renewals.length} license renewal(s) within 30 days
          </p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {renewals.slice(0, 5).map((l) => (
              <li key={l.license_id}>
                {l.product_name} · {l.renewal_date?.slice(0, 10)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(msg || err) && (
        <p className={`text-sm ${err ? 'text-destructive' : 'text-emerald-700'}`}>
          {err ?? msg}
        </p>
      )}
      {intunePhase40Health ? (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            intunePhase40Health.slo_state === 'healthy'
              ? 'border-emerald-600/40 bg-emerald-50 text-emerald-950'
              : 'border-amber-600/40 bg-amber-50 text-amber-950'
          }`}
        >
          <strong>Intune provider health: {intunePhase40Health.slo_state}</strong>
          {' · '}outages {Number(intunePhase40Health.active_outage_count)} active /{' '}
          {Number(intunePhase40Health.recovering_outage_count)} recovering
          {' · '}alerts {Number(intunePhase40Health.open_incident_count)}
          {' · '}breakers {Number(intunePhase40Health.open_breaker_count)} open /{' '}
          {Number(intunePhase40Health.recovering_breaker_count)} half-open
          {' · '}last read-only canary success{' '}
          {intunePhase40Health.last_canary_success_at ?? 'never'}
        </div>
      ) : null}

      {canWrite && (
        <div className="grid gap-6 lg:grid-cols-2">
          <form action={hwAction} className="space-y-3 rounded-lg border p-4">
            <h2 className="text-sm font-semibold">Add hardware</h2>
            <div className="space-y-1">
              <Label htmlFor="kind">Kind</Label>
              <select
                id="kind"
                name="kind"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue="laptop"
              >
                <option value="laptop">Laptop</option>
                <option value="phone">Phone</option>
                <option value="peripheral">Peripheral</option>
                <option value="other_hardware">Other</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="model">Model</Label>
              <Input id="model" name="model" placeholder="MacBook Pro 14" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="serial_number">Serial</Label>
              <Input id="serial_number" name="serial_number" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="warranty_ends_at">Warranty ends</Label>
              <Input id="warranty_ends_at" name="warranty_ends_at" type="date" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="entity_id">Entity id (optional)</Label>
              <Input id="entity_id" name="entity_id" placeholder="ENT-001" />
            </div>
            <Button type="submit" size="sm" disabled={hwPending}>
              Create asset
            </Button>
            <ActionMessage state={hwState} />
          </form>

          <form action={licAction} className="space-y-3 rounded-lg border p-4">
            <h2 className="text-sm font-semibold">Add software license</h2>
            <div className="space-y-1">
              <Label htmlFor="product_name">Product</Label>
              <Input
                id="product_name"
                name="product_name"
                required
                placeholder="Microsoft 365"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vendor">Vendor</Label>
              <Input id="vendor" name="vendor" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="seat_count">Seats</Label>
              <Input
                id="seat_count"
                name="seat_count"
                type="number"
                min={1}
                defaultValue={5}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lic_entity">Entity id (optional)</Label>
              <Input id="lic_entity" name="entity_id" placeholder="ENT-001" />
            </div>
            <Button type="submit" size="sm" disabled={licPending}>
              Create license
            </Button>
            <ActionMessage state={licState} />
          </form>
        </div>
      )}

      {canWrite && (
        <form action={warrantyAction} className="space-y-3 rounded-lg border p-4">
          <h2 className="text-sm font-semibold">Bulk warranty CSV import</h2>
          <p className="text-xs text-muted-foreground">
            Header: <code>asset_id,warranty_ends_at</code> or{' '}
            <code>serial_number,warranty_ends_at</code>. Quoted CSV supported,
            max 500 KB. Preview validates every row without changing assets.
          </p>
          <Input
            name="csv_file"
            type="file"
            accept=".csv,text/csv,text/plain"
          />
          <p className="text-xs text-muted-foreground">
            Or paste CSV:
          </p>
          <textarea
            name="lines"
            rows={4}
            className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
            placeholder={
              'asset_id,warranty_ends_at\nHW-ABC123,2027-06-30'
            }
          />
          <Button type="submit" size="sm" disabled={warrantyPending}>
            Preview warranties
          </Button>
          <ActionMessage state={warrantyState} />
        </form>
      )}

      {canWrite && (
        <form
          action={warrantyCommitAction}
          className="space-y-3 rounded-lg border p-4"
        >
          <h2 className="text-sm font-semibold">Commit warranty preview</h2>
          <p className="text-xs text-muted-foreground">
            Copy the batch ID and SHA-256 hash from a successful preview.
            Commit locks and revalidates every target, then updates all assets
            and audit events in one transaction.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input name="batch_id" required placeholder="Batch UUID" />
            <Input
              name="source_sha256"
              required
              pattern="[a-f0-9]{64}"
              placeholder="Source SHA-256"
            />
          </div>
          <Button type="submit" size="sm" disabled={warrantyCommitPending}>
            Commit atomically
          </Button>
          <ActionMessage state={warrantyCommitState} />
        </form>
      )}

      <section className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Intune action queue</h2>
            <p className="text-xs text-muted-foreground">
              Inventory creates requested intents. Retirement requires explicit
              approval, leased worker submission, and provider verification.
            </p>
          </div>
          {canIntuneRetire ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => runIntuneWorkerAction())}
            >
              Run Intune worker
            </Button>
          ) : null}
        </div>
        {intuneBreakerHealth.length > 0 ? (
          <div className="space-y-2 rounded border p-3 text-xs">
            <p className="font-medium">Provider dispatch circuit health</p>
            {intuneBreakerHealth.map((breaker) => {
              const pendingReset = intuneBreakerResetProposals.find(
                (proposal) =>
                  proposal.breaker_id === breaker.breaker_id &&
                  proposal.status === 'awaiting_review',
              );
              const pendingTuning = intuneTuningProposals.find(
                (proposal) =>
                  proposal.breaker_id === breaker.breaker_id &&
                  !proposal.decision,
              );
              return (
                <div
                  key={breaker.breaker_id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2"
                >
                  <span>
                    {breaker.entity_id ?? 'firm'} · {breaker.provider}/
                    {breaker.operation} ·{' '}
                    <strong
                      className={
                        breaker.state === 'closed'
                          ? 'text-emerald-700'
                          : 'text-amber-700'
                      }
                    >
                      {breaker.state}
                    </strong>
                    {' · '}age {Math.round(Number(breaker.state_age_minutes))}m
                    {' · '}blocked {Number(breaker.blocked_action_count)}
                    {' · '}failures {Number(breaker.failure_count)}/
                    {Number(breaker.sample_count)}
                    {breaker.canary_action_id
                      ? ` · canary ${breaker.canary_action_id.slice(0, 8)}…`
                      : ''}
                    {breaker.canary_post_accepted_at
                      ? ' · POST accepted, verification pending'
                      : ''}
                    {' · '}policy {breaker.failure_threshold}/
                    {breaker.minimum_samples} at{' '}
                    {Math.round(Number(breaker.failure_rate_threshold) * 100)}%
                    {' · '}window {breaker.failure_window_minutes}m
                  </span>
                  {canIntuneManualReview && !pendingTuning ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        const values = window.prompt(
                          'Tuning values: window minutes, minimum samples, failure threshold, failure rate, reset successes',
                          [
                            breaker.failure_window_minutes,
                            breaker.minimum_samples,
                            breaker.failure_threshold,
                            breaker.failure_rate_threshold,
                            breaker.reset_success_threshold,
                          ].join(','),
                        );
                        if (!values) return;
                        const parsed = values
                          .split(',')
                          .map((value) => Number(value.trim()));
                        if (
                          parsed.length !== 5 ||
                          parsed.some((value) => !Number.isFinite(value))
                        ) {
                          setErr('Enter five comma-separated numeric values');
                          return;
                        }
                        const reason = window.prompt(
                          'Tuning reason (20+ characters):',
                        );
                        if (!reason?.trim()) return;
                        run(() =>
                          proposeIntuneBreakerTuningAction({
                            breakerId: breaker.breaker_id,
                            reason: reason.trim(),
                            expectedBreakerVersion: breaker.row_version,
                            failureWindowMinutes: parsed[0],
                            minimumSamples: parsed[1],
                            failureThreshold: parsed[2],
                            failureRateThreshold: parsed[3],
                            resetSuccessThreshold: parsed[4],
                          }),
                        );
                      }}
                    >
                      Propose tuning
                    </Button>
                  ) : null}
                  {canIntuneManualReview && pendingTuning ? (
                    pendingTuning.proposed_by === currentActorId ? (
                      <span>
                        {pendingTuning.risk_class} tuning awaits another reviewer
                      </span>
                    ) : (
                      <>
                        <span>
                          {pendingTuning.risk_class} tuning v
                          {pendingTuning.base_config_version_no + 1} awaiting review
                        </span>
                        {(['approve', 'reject'] as const).map((decision) => (
                          <Button
                            key={`tuning-${decision}`}
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() => {
                              const statement = window.prompt(
                                `${decision} tuning statement (20+ characters):`,
                              );
                              if (!statement?.trim()) return;
                              run(() =>
                                reviewIntuneBreakerTuningAction({
                                  proposalId: pendingTuning.proposal_id,
                                  decision,
                                  statement: statement.trim(),
                                  expectedBreakerVersion: breaker.row_version,
                                }),
                              );
                            }}
                          >
                            {decision === 'approve'
                              ? 'Approve tuning'
                              : 'Reject tuning'}
                          </Button>
                        ))}
                      </>
                    )
                  ) : null}
                  {canIntuneManualReview &&
                  breaker.state === 'open' &&
                  !pendingReset ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        const reason = window.prompt(
                          'Reset proposal reason (20+ characters). Cooldown and durable read recovery thresholds are enforced:',
                        );
                        if (!reason?.trim()) return;
                        run(() =>
                          proposeIntuneBreakerResetAction({
                            breakerId: breaker.breaker_id,
                            reason: reason.trim(),
                            expectedBreakerVersion: breaker.row_version,
                          }),
                        );
                      }}
                    >
                      Propose canary reset
                    </Button>
                  ) : null}
                  {canIntuneManualReview &&
                  breaker.state === 'open' &&
                  pendingReset ? (
                    pendingReset.proposed_by === currentActorId ? (
                      <span>A different authorized actor must review reset</span>
                    ) : (
                      <>
                        <span>
                          Reset awaiting review · expires {pendingReset.expires_at}
                        </span>
                        {(['approve', 'reject'] as const).map((decision) => (
                          <Button
                            key={decision}
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() => {
                              const statement = window.prompt(
                                `${decision === 'approve' ? 'Independent approval' : 'Rejection'} statement (20+ characters):`,
                              );
                              if (!statement?.trim()) return;
                              run(() =>
                                reviewIntuneBreakerResetAction({
                                  proposalId: pendingReset.proposal_id,
                                  decision,
                                  statement: statement.trim(),
                                  expectedProposalVersion:
                                    pendingReset.row_version,
                                  expectedBreakerVersion: breaker.row_version,
                                }),
                              );
                            }}
                          >
                            {decision === 'approve'
                              ? 'Approve one canary'
                              : 'Reject reset'}
                          </Button>
                        ))}
                      </>
                    )
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
        {intuneActions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Intune actions.</p>
        ) : (
          <div className="space-y-2 text-xs">
            {intuneActions.map((action) => {
              const metadata = action.request_metadata;
              const providerSerial = String(metadata.serial_number ?? '')
                .replace(/[^a-z0-9]/gi, '')
                .toUpperCase();
              const matchingAssets = hardware.filter(
                (asset) =>
                  Boolean(providerSerial) &&
                  String(asset.serial_number ?? '')
                    .replace(/[^a-z0-9]/gi, '')
                    .toUpperCase() === providerSerial,
              );
              const pendingResolution = intuneAmbiguityResolutions.find(
                (resolution) =>
                  resolution.action_id === action.action_id &&
                  resolution.status === 'awaiting_review',
              );
              const manualSlo = intuneManualReviewSlo.find(
                (row) => String(row.action_id) === action.action_id,
              );
              return (
                <div
                  className="rounded border p-2"
                  key={action.action_id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <strong>{String(metadata.device_name ?? action.managed_device_id)}</strong>{' '}
                      · {action.status} · {action.entity_id ?? 'firm'}
                    </span>
                    {canIntuneRetire &&
                    action.status === 'requested' &&
                    action.local_asset_id ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => {
                          const confirmation = window.prompt(
                            'Type RETIRE to confirm this irreversible Intune action:',
                          );
                          if (confirmation !== 'RETIRE') return;
                          const reason = window.prompt(
                            'Approval reason (required):',
                          );
                          if (!reason?.trim()) return;
                          run(() =>
                            approveIntuneActionAction(
                              action.action_id,
                              reason.trim(),
                              action.row_version,
                              action.match_sha256 || '',
                            ),
                          );
                        }}
                      >
                        Approve retire
                      </Button>
                    ) : null}
                    {canIntuneRetire &&
                    action.status === 'requested' &&
                    !action.local_asset_id
                      ? matchingAssets.map((asset) => (
                          <Button
                            key={asset.asset_id}
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() =>
                              run(() =>
                                matchIntuneActionAction(
                                  action.action_id,
                                  asset.asset_id,
                                  action.row_version,
                                ),
                              )
                            }
                          >
                            Match {asset.asset_id}
                          </Button>
                        ))
                      : null}
                    {canIntuneRetire &&
                    ['requested', 'approved', 'preflighting'].includes(action.status) ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => {
                          const reason = window.prompt(
                            'Cancellation reason (this does not reverse a submitted provider action):',
                          );
                          if (!reason?.trim()) return;
                          run(() =>
                            cancelIntuneActionAction(
                              action.action_id,
                              reason.trim(),
                              action.row_version,
                            ),
                          );
                        }}
                      >
                        Cancel
                      </Button>
                    ) : null}
                    {['dispatch_authorized', 'submitted', 'verifying'].includes(
                      action.status,
                    ) ? (
                      <span className="text-xs text-amber-700">
                        Provider dispatch authorized — verification only
                      </span>
                    ) : null}
                    {action.status === 'manual_review' ? (
                      <span className="text-xs font-medium text-amber-700">
                        Quarantined — no polling or redispatch
                      </span>
                    ) : null}
                    {canIntuneManualReview &&
                    action.status === 'manual_review' &&
                    !pendingResolution
                      ? (
                          [
                            ['confirm_retired', 'Confirm retired'],
                            ['close_unresolved', 'Close unresolved'],
                            ['create_retry_child', 'Propose retry child'],
                          ] as const
                        ).map(([decision, label]) => (
                          <Button
                            key={decision}
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() => {
                              const reason = window.prompt(
                                `${label} reason (20+ characters). Fresh read-only Graph evidence will be captured:`,
                              );
                              if (!reason?.trim()) return;
                              run(() =>
                                proposeIntuneAmbiguityResolutionAction({
                                  actionId: action.action_id,
                                  decision,
                                  reason: reason.trim(),
                                  expectedActionVersion: action.row_version,
                                }),
                              );
                            }}
                          >
                            {label}
                          </Button>
                        ))
                      : null}
                    {canIntuneManualReview &&
                    action.status === 'manual_review' &&
                    pendingResolution ? (
                      <>
                        <span className="text-xs text-muted-foreground">
                          Awaiting independent review: {pendingResolution.decision}
                          {' · '}expires {pendingResolution.expires_at}
                        </span>
                        {pendingResolution.proposed_by !== currentActorId ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() => {
                                const statement = window.prompt(
                                  'Independent approval statement (20+ characters). A new Graph GET will be captured:',
                                );
                                if (!statement?.trim()) return;
                                run(() =>
                                  reviewIntuneAmbiguityResolutionAction({
                                    resolutionId:
                                      pendingResolution.resolution_id,
                                    reviewDecision: 'approve',
                                    statement: statement.trim(),
                                    expectedResolutionVersion:
                                      pendingResolution.row_version,
                                    expectedActionVersion: action.row_version,
                                  }),
                                );
                              }}
                            >
                              Approve resolution
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() => {
                                const statement = window.prompt(
                                  'Rejection statement (20+ characters):',
                                );
                                if (!statement?.trim()) return;
                                run(() =>
                                  reviewIntuneAmbiguityResolutionAction({
                                    resolutionId:
                                      pendingResolution.resolution_id,
                                    reviewDecision: 'reject',
                                    statement: statement.trim(),
                                    expectedResolutionVersion:
                                      pendingResolution.row_version,
                                    expectedActionVersion: action.row_version,
                                  }),
                                );
                              }}
                            >
                              Reject
                            </Button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            A different authorized actor must review
                          </span>
                        )}
                      </>
                    ) : null}
                    {canIntuneRetire &&
                    ['failed', 'cancelled'].includes(action.status) &&
                    !action.dispatch_authorized_at &&
                    action.retry_generation < 2 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => {
                          const reason = window.prompt(
                            'Retry reason (fresh match and approval will be required):',
                          );
                          if (!reason?.trim()) return;
                          run(() =>
                            retryIntuneActionAction(
                              action.action_id,
                              reason.trim(),
                              action.row_version,
                            ),
                          );
                        }}
                      >
                        Governed retry
                      </Button>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground">
                    device {action.managed_device_id} · serial{' '}
                    {String(metadata.serial_number ?? 'unknown')} · attempts{' '}
                    {action.attempt_count} · polls {action.poll_count}
                  </p>
                  <p className="text-muted-foreground">
                    asset {action.local_asset_id ?? 'unmatched'} · generation{' '}
                    {action.retry_generation} · version {action.row_version}
                    {action.match_sha256
                      ? ` · match ${action.match_sha256.slice(0, 12)}…`
                      : ''}
                  </p>
                  <p className="text-muted-foreground">
                    Graph {action.graph_request_id ?? 'not submitted'} · provider{' '}
                    {action.provider_state ?? 'pending'} · verification{' '}
                    {action.verification_code ?? 'pending'}
                  </p>
                  <p className="text-muted-foreground">
                    approval expires {action.approval_expires_at ?? 'n/a'} ·
                    dispatch authorized {action.dispatch_authorized_at ?? 'no'} ·
                    lease {action.lease_expires_at ?? 'none'}
                  </p>
                  {action.status === 'manual_review' ? (
                    <p className="text-amber-700">
                      review started {action.manual_review_started_at ?? 'unknown'}
                      {manualSlo
                        ? ` · ${String(manualSlo.slo_state)} · ${Math.round(
                            Number(manualSlo.age_minutes ?? 0),
                          )} min`
                        : ''}
                    </p>
                  ) : null}
                  {action.last_error_code ? (
                    <p className="text-destructive">
                      {action.last_error_class ?? 'error'} ·{' '}
                      {action.last_error_code}
                    </p>
                  ) : null}
                  {action.last_error ? (
                    <p className="text-destructive">{action.last_error}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {intuneAmbiguityResolutions.length > 0 ? (
          <div className="space-y-1 rounded border p-2 text-xs">
            <p className="font-medium">Ambiguity review history</p>
            {intuneAmbiguityResolutions.slice(0, 10).map((resolution) => (
              <p key={resolution.resolution_id}>
                {resolution.proposed_at} · action{' '}
                {resolution.action_id.slice(0, 8)}… · {resolution.decision} ·{' '}
                {resolution.status} · evidence{' '}
                {resolution.evidence_sha256.slice(0, 12)}…
                {resolution.retry_child_action_id
                  ? ` · child ${resolution.retry_child_action_id.slice(0, 8)}…`
                  : ''}
              </p>
            ))}
          </div>
        ) : null}
        {intuneWorkerRuns.length > 0 ? (
          <div className="space-y-1 rounded border p-2 text-xs">
            <p className="font-medium">Recent worker runs</p>
            {intuneWorkerRuns.slice(0, 6).map((runRow) => (
              <p key={String(runRow.worker_run_id)}>
                {String(runRow.started_at)} · {String(runRow.status)} · claimed{' '}
                {String(runRow.claimed)} · succeeded {String(runRow.succeeded)} ·
                failed {String(runRow.failed)}
                {' · '}preflight {String(runRow.preflighted ?? 0)}
                {' · '}authorized {String(runRow.authorized ?? 0)}
                {' · '}ambiguous {String(runRow.ambiguous ?? 0)}
              </p>
            ))}
          </div>
        ) : null}
        {intuneDispatchAttempts.length > 0 ? (
          <div className="space-y-1 rounded border p-2 text-xs">
            <p className="font-medium">Dispatch authorization evidence</p>
            {intuneDispatchAttempts.slice(0, 8).map((attempt) => (
              <p key={String(attempt.dispatch_attempt_id)}>
                {String(attempt.authorized_at)} · action{' '}
                {String(attempt.action_id).slice(0, 8)}… · attempt{' '}
                {String(attempt.dispatch_attempt_id).slice(0, 8)}… ·{' '}
                {String(attempt.outcome ?? 'authorized')} · preflight{' '}
                {String(attempt.provider_preflight_sha256).slice(0, 12)}…
              </p>
            ))}
          </div>
        ) : null}
        {intuneEvents.length > 0 ? (
          <div className="space-y-1 rounded border p-2 text-xs">
            <p className="font-medium">Recent action transitions</p>
            {intuneEvents.slice(0, 10).map((eventRow) => (
              <p key={String(eventRow.event_id)}>
                {String(eventRow.occurred_at)} · {String(eventRow.action_id)} ·{' '}
                {String(eventRow.from_status ?? 'new')} →{' '}
                {String(eventRow.to_status)} · {String(eventRow.source)}
              </p>
            ))}
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Hardware</h2>
        {hardware.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hardware assets yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-2">Asset</th>
                  <th className="py-2 pr-2">Kind</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Model</th>
                  <th className="py-2 pr-2">Warranty</th>
                  <th className="py-2 pr-2">Assigned</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {hardware.map((a) => (
                  <tr key={a.asset_id} className="border-b border-border/40">
                    <td className="py-2 pr-2 font-mono text-xs">{a.asset_id}</td>
                    <td className="py-2 pr-2">{a.kind}</td>
                    <td className="py-2 pr-2">{a.status}</td>
                    <td className="py-2 pr-2">{a.model ?? '—'}</td>
                    <td className="py-2 pr-2 text-xs">
                      {a.warranty_ends_at?.slice(0, 10) ?? '—'}
                    </td>
                    <td className="py-2 pr-2 font-mono text-xs">
                      {a.assigned_user_id?.slice(0, 8) ?? '—'}
                    </td>
                    <td className="py-2">
                      {canWrite && (
                        <div className="flex flex-wrap gap-1">
                          {a.status !== 'assigned' && a.status !== 'retired' && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() => {
                                const userId = window.prompt(
                                  'Assign to user UUID:',
                                );
                                if (!userId) return;
                                run(() =>
                                  assignHardwareAction(a.asset_id, userId),
                                );
                              }}
                            >
                              Assign
                            </Button>
                          )}
                          {a.status === 'assigned' && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() =>
                                run(() => returnHardwareAction(a.asset_id))
                              }
                            >
                              Return
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Software licenses</h2>
        {canWrite && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => scanLicenseRenewalsAction())}
          >
            Scan renewals (30d)
          </Button>
        )}
        {licenses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No licenses yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-2">License</th>
                  <th className="py-2 pr-2">Product</th>
                  <th className="py-2 pr-2">Seats</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {licenses.map((l) => (
                  <tr key={l.license_id} className="border-b border-border/40">
                    <td className="py-2 pr-2 font-mono text-xs">
                      {l.license_id}
                    </td>
                    <td className="py-2 pr-2">
                      {l.product_name}
                      {l.vendor ? (
                        <span className="text-muted-foreground">
                          {' '}
                          · {l.vendor}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2">
                      {l.seats_used ?? 0}
                      {l.seat_count != null ? ` / ${l.seat_count}` : ''}
                    </td>
                    <td className="py-2 pr-2">{l.status}</td>
                    <td className="py-2">
                      {canWrite && l.status === 'active' && (
                        <div className="flex flex-wrap gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() =>
                              run(() => grantSeatAction(l.license_id))
                            }
                          >
                            Grant seat
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() =>
                              run(() => revokeSeatAction(l.license_id))
                            }
                          >
                            Revoke
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>


      <section className="space-y-3">
        <h2 className="text-base font-semibold">Onboarding</h2>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                const userId = window.prompt('User UUID to onboard:');
                if (!userId) return;
                const auto = window.confirm(
                  'Auto-assign stock hardware + grant seats now?',
                );
                run(() =>
                  startOnboardingAction(userId.trim(), undefined, auto),
                );
              }}
            >
              Start onboarding
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => scanActiveOnboardingAction())}
            >
              Scan active profiles
            </Button>
          </div>
        )}
        {onboardingTickets.length > 0 && (
          <div className="space-y-2 rounded-md border border-border/60 p-3">
            <p className="text-xs font-medium text-muted-foreground">
              HR/IT tickets that look like onboarding (include{' '}
              <code className="text-xs">user:&lt;uuid&gt;</code> in description)
            </p>
            <ul className="space-y-1 text-sm">
              {onboardingTickets.map((t) => (
                <li
                  key={t.ticket_id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 py-1.5"
                >
                  <span>
                    <a
                      href={`/shared-services/tickets/${t.ticket_id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {t.ticket_id}
                    </a>
                    {' · '}
                    {t.title}
                  </span>
                  {canWrite && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          startOnboardingFromTicketAction(t.ticket_id, true),
                        )
                      }
                    >
                      Start from ticket
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {onboarding.length === 0 ? (
          <p className="text-sm text-muted-foreground">No onboarding runs yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {onboarding.map((r) => (
              <li key={r.run_id} className="rounded-md border border-border/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-mono text-xs">{r.run_id}</span>
                    {' · '}
                    {r.status}
                    {' · '}
                    {r.source}
                    {r.ticket_id ? ` · ${r.ticket_id}` : ''}
                    {' · user '}
                    {r.user_id.slice(0, 8)}…
                  </span>
                  {canWrite && r.status !== 'completed' && (
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          run(() => executeOnboardingAction(r.run_id))
                        }
                      >
                        Execute
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          run(() => completeOnboardingAction(r.run_id))
                        }
                      >
                        Mark complete
                      </Button>
                    </div>
                  )}
                </div>
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {r.checklist.map((c) => (
                    <li key={c.id}>
                      {c.status === 'done' ? '✓' : c.status === 'failed' ? '✗' : '○'}{' '}
                      {c.label}
                      {c.detail ? ` · ${c.detail}` : ''}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Offboarding</h2>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                const userId = window.prompt('User UUID to offboard:');
                if (!userId) return;
                const auto = window.confirm(
                  'Auto-execute hardware return + license revoke now?',
                );
                run(() =>
                  startOffboardingAction(userId.trim(), undefined, auto),
                );
              }}
            >
              Start offboarding
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => scanInactiveOffboardingAction())}
            >
              Scan inactive profiles
            </Button>
          </div>
        )}
        {candidateTickets.length > 0 && (
          <div className="space-y-2 rounded-md border border-border/60 p-3">
            <p className="text-xs font-medium text-muted-foreground">
              HR/IT tickets that look like offboarding (include{' '}
              <code className="text-xs">user:&lt;uuid&gt;</code> in description)
            </p>
            <ul className="space-y-1 text-sm">
              {candidateTickets.map((t) => (
                <li
                  key={t.ticket_id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 py-1.5"
                >
                  <span>
                    <a
                      href={`/shared-services/tickets/${t.ticket_id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {t.ticket_id}
                    </a>
                    {' · '}
                    {t.title}
                    <span className="text-xs text-muted-foreground">
                      {' '}
                      · {t.service}
                    </span>
                  </span>
                  {canWrite && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          startOffboardingFromTicketAction(t.ticket_id, true),
                        )
                      }
                    >
                      Start from ticket
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {offboarding.length === 0 ? (
          <p className="text-sm text-muted-foreground">No offboarding runs yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {offboarding.map((r) => (
              <li key={r.run_id} className="rounded-md border border-border/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-mono text-xs">{r.run_id}</span>
                    {' · '}
                    {r.status}
                    {' · '}
                    {r.source}
                    {r.ticket_id ? ` · ${r.ticket_id}` : ''}
                    {' · user '}
                    {r.user_id.slice(0, 8)}…
                  </span>
                  {canWrite && r.status !== 'completed' && (
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          run(() => executeOffboardingAction(r.run_id))
                        }
                      >
                        Execute
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          run(() => completeOffboardingAction(r.run_id))
                        }
                      >
                        Mark complete
                      </Button>
                    </div>
                  )}
                </div>
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {r.checklist.map((c) => (
                    <li key={c.id}>
                      {c.status === 'done' ? '✓' : c.status === 'failed' ? '✗' : '○'}{' '}
                      {c.label}
                      {c.detail ? ` · ${c.detail}` : ''}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Offboarding lifecycle events</h2>
        {lifecycleEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tracked lifecycle attempts yet.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {lifecycleEvents.map((e) => (
              <li
                key={e.event_id}
                className="border-b border-border/40 py-1.5 text-muted-foreground"
              >
                <span
                  className={
                    e.status === 'done'
                      ? 'text-emerald-700'
                      : e.status === 'failed'
                        ? 'text-destructive'
                        : 'text-foreground'
                  }
                >
                  {e.status}
                </span>
                {' · '}
                <span className="font-mono text-xs">
                  {e.run_id ?? 'manual'} / {e.item_id}
                </span>
                {e.detail ? ` · ${e.detail}` : ''}
                <span className="block text-xs">
                  {e.occurred_at.slice(0, 19).replace('T', ' ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Assignment history</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {events.map((e) => (
              <li
                key={e.event_id}
                className="border-b border-border/40 py-1.5 text-muted-foreground"
              >
                <span className="font-medium text-foreground">{e.kind}</span>
                {' · '}
                {e.asset_id || e.license_id || '—'}
                {e.user_id ? ` · user ${e.user_id.slice(0, 8)}…` : ''}
                {' · '}
                <span className="text-xs">
                  {e.created_at.slice(0, 19).replace('T', ' ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
