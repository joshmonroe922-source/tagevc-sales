'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  archiveExpiredSloExportsAction,
  exportSloSimulationAction,
  proposeSloOwnerSuccessionAction,
  recordSloExportAuditAccessAction,
  requestSloRouteTestAction,
  requestSloSimulationAction,
  resolveSloOwnerHandoffSuggestionAction,
  runSloOwnerSuccessionDrillAction,
  runSloNightlyScenarioReplayAction,
  generateSloOwnerHandoffDigestAction,
  runSloFirmWideNightlyReplayAction,
  publishSloOwnerHandoffDigestAction,
  notifySloHandoffDigestOwnersAction,
  scanSloOwnershipChangeVisibilityAction,
  deliverSloOwnerDigestWebhooksAction,
  scanSloDigestNotificationDeliverySloAction,
  scanSloOwnerDigestDeliverySuccessAction,
  saveSloPolicyDraftAction,
  suggestSloOwnerHandoffsAction,
  transitionSloPolicyDraftAction,
  recordSloOwnerDigestWowTrendAction,
  setSloOwnerDigestSelfServeOptInAction,
  listSloOwnerDigestSelfServeFailuresAction,
  listSloOwnerDigestSelfServeTrendAction,
  listSloFirmDigestAdminSummaryTrendAction,
} from '@/app/(app)/shared-services/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  SloDraftComparison,
  SloOwnerOption,
  SloPolicyRow,
} from '@/lib/shared-services/slo-policy';

type EntityOption = { entity_id: string; canonical_name: string };

function ownerLabel(owner: SloOwnerOption | undefined) {
  return owner ? owner.full_name?.trim() || owner.email : 'Unassigned';
}

function PolicyEditor({
  active,
  draft,
  owners,
  entities,
  onMessage,
  comparison,
}: {
  active: SloPolicyRow;
  draft?: SloPolicyRow;
  owners: SloOwnerOption[];
  entities: EntityOption[];
  onMessage: (message: string) => void;
  comparison?: SloDraftComparison;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const value = draft ?? active;
  const [version, setVersion] = useState(
    draft?.policy_version ?? `${active.policy_version}.next`,
  );
  const [ownerId, setOwnerId] = useState(
    value.owner_id ?? owners[0]?.id ?? '',
  );
  const [ownerEntityId, setOwnerEntityId] = useState(value.owner_entity_id ?? '');
  const [webhooks, setWebhooks] = useState(
    Object.keys(value.config?.webhook_destinations ?? {}).join(', '),
  );
  const [ownerExpiresAt, setOwnerExpiresAt] = useState(
    value.owner_expires_at?.slice(0, 16) ?? '',
  );
  const [replacementOwnerId, setReplacementOwnerId] = useState(
    value.replacement_owner_id ?? '',
  );

  function save(formData: FormData) {
    const keys = webhooks.split(',').map((key) => key.trim()).filter(Boolean);
    startTransition(async () => {
      const result = await saveSloPolicyDraftAction({
        sourcePolicyId: active.policy_id,
        draftPolicyId: draft?.policy_id ?? null,
        policyVersion: version,
        comparator: String(formData.get('comparator')) as 'higher_bad' | 'lower_bad',
        warningThreshold: Number(formData.get('warning')),
        criticalThreshold: Number(formData.get('critical')),
        windowSeconds: Number(formData.get('window')),
        evaluationIntervalSeconds: Number(formData.get('interval')),
        warningBreachBuckets: Number(formData.get('warningBuckets')),
        recoveryBuckets: Number(formData.get('recoveryBuckets')),
        webhookDestinationKeys: keys,
        ownerId,
        ownerEntityId: ownerEntityId || null,
        ownerEffectiveAt: value.owner_effective_at ?? new Date().toISOString(),
        ownerExpiresAt: ownerExpiresAt
          ? new Date(ownerExpiresAt).toISOString()
          : null,
        replacementOwnerId: ownerExpiresAt ? replacementOwnerId : null,
        expectedRowVersion: draft?.row_version ?? active.row_version,
      });
      onMessage(result.ok ? result.message ?? 'Saved' : result.error);
      if (result.ok) router.refresh();
    });
  }

  function transition(kind: 'validate' | 'publish') {
    if (!draft) return;
    startTransition(async () => {
      const result = await transitionSloPolicyDraftAction({
        policyId: draft.policy_id,
        rowVersion: draft.row_version,
        transition: kind,
        ownerEffectiveAt: new Date().toISOString(),
        ownerExpiresAt: ownerExpiresAt
          ? new Date(ownerExpiresAt).toISOString()
          : null,
        replacementOwnerId: ownerExpiresAt ? replacementOwnerId : null,
      });
      onMessage(result.ok ? result.message ?? kind : result.error);
      if (result.ok) router.refresh();
    });
  }

  const eligibleOwners = owners.filter(
    (owner) => {
      if (!ownerEntityId) {
        return (
          owner.entity_id === null ||
          ['visionary', 'admin'].includes(owner.role)
        );
      }
      return (
        owner.entity_id === ownerEntityId ||
        ['visionary', 'admin', 'service_lead'].includes(owner.role)
      );
    },
  );
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">
            {active.service} / {active.metric_key.replaceAll('_', ' ')}
          </CardTitle>
          <div className="flex gap-1">
            <Badge variant="secondary">active {active.policy_version}</Badge>
            <Badge variant={draft ? 'outline' : 'secondary'}>
              {draft ? `${draft.lifecycle_status} v${draft.row_version}` : 'no draft'}
            </Badge>
          </div>
        </div>
        <CardDescription>
          Owner: {ownerLabel(owners.find((owner) => owner.id === value.owner_id))}
        </CardDescription>
        {comparison ? (
          <div className="flex flex-wrap gap-1">
            <Badge variant={comparison.material_risk ? 'destructive' : 'secondary'}>
              {comparison.material_risk ? 'material risk' : 'non-material'}
            </Badge>
            {comparison.changes.map((change) => (
              <Badge key={change.field} variant="outline">
                {change.field.replaceAll('_', ' ')}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        <details>
          <summary className="cursor-pointer text-sm font-medium">Edit governed policy</summary>
          <form action={save} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label>Version</Label>
              <Input value={version} onChange={(event) => setVersion(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Comparator</Label>
              <select name="comparator" defaultValue={value.comparator} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                <option value="higher_bad">Higher is bad</option>
                <option value="lower_bad">Lower is bad</option>
              </select>
            </div>
            <div className="space-y-1"><Label>Warning</Label><Input name="warning" type="number" step="any" defaultValue={value.warning_threshold} /></div>
            <div className="space-y-1"><Label>Critical</Label><Input name="critical" type="number" step="any" defaultValue={value.critical_threshold} /></div>
            <div className="space-y-1"><Label>Window seconds</Label><Input name="window" type="number" defaultValue={value.window_seconds} /></div>
            <div className="space-y-1"><Label>Evaluation seconds</Label><Input name="interval" type="number" defaultValue={value.evaluation_interval_seconds} /></div>
            <div className="space-y-1"><Label>Warning buckets</Label><Input name="warningBuckets" type="number" defaultValue={value.warning_breach_buckets} /></div>
            <div className="space-y-1"><Label>Recovery buckets</Label><Input name="recoveryBuckets" type="number" defaultValue={value.recovery_buckets} /></div>
            {active.scope === 'entity' ? (
              <div className="space-y-1">
                <Label>Owner entity</Label>
                <select value={ownerEntityId} onChange={(event) => setOwnerEntityId(event.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                  <option value="">Firm fallback</option>
                  {entities.map((entity) => <option key={entity.entity_id} value={entity.entity_id}>{entity.canonical_name}</option>)}
                </select>
              </div>
            ) : null}
            <div className="space-y-1">
              <Label>Named active owner</Label>
              <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                {eligibleOwners.map((owner) => <option key={owner.id} value={owner.id}>{ownerLabel(owner)} · {owner.role}</option>)}
              </select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Webhook destination keys (comma separated)</Label>
              <Input value={webhooks} onChange={(event) => setWebhooks(event.target.value)} placeholder="ops_alerts, security" />
              <p className="text-xs text-muted-foreground">Keys resolve through SLO_WEBHOOK_* environment variables. URLs are rejected.</p>
            </div>
            <div className="space-y-1">
              <Label>Owner expires (optional)</Label>
              <Input type="datetime-local" value={ownerExpiresAt} onChange={(event) => setOwnerExpiresAt(event.target.value)} />
            </div>
            {ownerExpiresAt ? (
              <div className="space-y-1">
                <Label>Named eligible replacement</Label>
                <select value={replacementOwnerId} onChange={(event) => setReplacementOwnerId(event.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                  <option value="">Select replacement</option>
                  {eligibleOwners.filter((owner) => owner.id !== ownerId).map((owner) => <option key={owner.id} value={owner.id}>{ownerLabel(owner)}</option>)}
                </select>
              </div>
            ) : null}
            <div className="flex items-end gap-2 sm:col-span-2">
              <Button type="submit" disabled={pending || !ownerId}>Save draft</Button>
              {draft?.lifecycle_status === 'draft' ? <Button type="button" variant="outline" disabled={pending} onClick={() => transition('validate')}>Validate</Button> : null}
              {draft?.lifecycle_status === 'validated' ? <Button type="button" variant="outline" disabled={pending || Boolean(ownerExpiresAt && !replacementOwnerId)} onClick={() => transition('publish')}>Publish as checker</Button> : null}
            </div>
          </form>
        </details>
      </CardContent>
    </Card>
  );
}

export function SloPolicyAdmin({
  activePolicies,
  drafts,
  owners,
  entities,
  routeTests,
  comparisons,
  simulations,
  ownerCoverage,
  simulationExports = [],
  coverageCalendar = [],
  successionProposals = [],
  successionDrills = [],
  archivalReceipts = [],
  handoffSuggestions = [],
  simulationScenarios = [],
  phase44Report = null,
  nightlyReplayRuns = [],
  handoffDigests = [],
  phase45Report = null,
  firmWideReplayRuns = [],
  digestPublications = [],
  ownershipChangeAlerts = [],
  phase46Report = null,
  digestNotifications = [],
  ownershipVisibility = [],
  phase47Report = null,
  digestDeliveries = [],
  digestDeliverySlos = [],
  phase48Report = null,
  ownerDigestSuccessSlos = [],
  phase49Report = null,
  ownerDigestWowTrendSnapshots = [],
  ownerDigestSelfServeOptIns = [],
  phase50Report = null,
  phase51Report = null,
  phase52Report = null,
}: {
  activePolicies: SloPolicyRow[];
  drafts: SloPolicyRow[];
  owners: SloOwnerOption[];
  entities: EntityOption[];
  routeTests: Array<Record<string, unknown>>;
  comparisons: SloDraftComparison[];
  simulations: Array<Record<string, unknown>>;
  ownerCoverage: Array<Record<string, unknown>>;
  simulationExports?: Array<Record<string, unknown>>;
  coverageCalendar?: Array<Record<string, unknown>>;
  successionProposals?: Array<Record<string, unknown>>;
  successionDrills?: Array<Record<string, unknown>>;
  archivalReceipts?: Array<Record<string, unknown>>;
  handoffSuggestions?: Array<Record<string, unknown>>;
  simulationScenarios?: Array<Record<string, unknown>>;
  phase44Report?: Record<string, unknown> | null;
  nightlyReplayRuns?: Array<Record<string, unknown>>;
  handoffDigests?: Array<Record<string, unknown>>;
  phase45Report?: Record<string, unknown> | null;
  firmWideReplayRuns?: Array<Record<string, unknown>>;
  digestPublications?: Array<Record<string, unknown>>;
  ownershipChangeAlerts?: Array<Record<string, unknown>>;
  phase46Report?: Record<string, unknown> | null;
  digestNotifications?: Array<Record<string, unknown>>;
  ownershipVisibility?: Array<Record<string, unknown>>;
  phase47Report?: Record<string, unknown> | null;
  digestDeliveries?: Array<Record<string, unknown>>;
  digestDeliverySlos?: Array<Record<string, unknown>>;
  phase48Report?: Record<string, unknown> | null;
  ownerDigestSuccessSlos?: Array<Record<string, unknown>>;
  phase49Report?: Record<string, unknown> | null;
  ownerDigestWowTrendSnapshots?: Array<Record<string, unknown>>;
  ownerDigestSelfServeOptIns?: Array<Record<string, unknown>>;
  phase50Report?: Record<string, unknown> | null;
  phase51Report?: Record<string, unknown> | null;
  phase52Report?: Record<string, unknown> | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const [adapter, setAdapter] = useState<'in_app_owner' | 'webhook'>('in_app_owner');
  const [ownerId, setOwnerId] = useState(owners[0]?.id ?? '');
  const [entityId, setEntityId] = useState('');
  const [destinationKey, setDestinationKey] = useState('owner');
  const [simulationDraftId, setSimulationDraftId] = useState(drafts[0]?.policy_id ?? '');
  const [simulationEntityId, setSimulationEntityId] = useState('');
  const [simulationDays, setSimulationDays] = useState(7);
  const [successionOwnerId, setSuccessionOwnerId] = useState(owners[0]?.id ?? '');

  function requestTest() {
    startTransition(async () => {
      const result = await requestSloRouteTestAction({
        idempotencyKey: `ui:${crypto.randomUUID()}`,
        entityId: entityId || null,
        adapter,
        destinationKey: adapter === 'in_app_owner' ? 'owner' : destinationKey,
        ownerId: adapter === 'in_app_owner' ? ownerId : null,
      });
      setMessage(result.ok ? result.message ?? 'Queued' : result.error);
      if (result.ok) router.refresh();
    });
  }

  function requestSimulation() {
    const draft = drafts.find((item) => item.policy_id === simulationDraftId);
    if (!draft) return;
    const endsAt = new Date();
    const startsAt = new Date(endsAt.getTime() - simulationDays * 86_400_000);
    startTransition(async () => {
      const result = await requestSloSimulationAction({
        idempotencyKey: `ui:${crypto.randomUUID()}`,
        draftPolicyId: draft.policy_id,
        entityIds: draft.scope === 'entity' && simulationEntityId ? [simulationEntityId] : [],
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        maxBuckets: Math.min(2160, simulationDays * 24),
      });
      setMessage(result.ok ? result.message ?? 'Queued' : result.error);
      if (result.ok) router.refresh();
    });
  }

  function exportSimulation(simulationId: string) {
    startTransition(async () => {
      const result = await exportSloSimulationAction({
        idempotencyKey: `ui:export:${crypto.randomUUID()}`,
        simulationId,
      });
      setMessage(result.ok ? result.message ?? 'Exported' : result.error);
      if (result.ok) router.refresh();
    });
  }

  function auditExportAccess(exportId: string) {
    startTransition(async () => {
      const result = await recordSloExportAuditAccessAction({
        exportId,
        accessType: 'viewed',
      });
      setMessage(result.ok ? result.message ?? 'Access recorded' : result.error);
      if (result.ok) router.refresh();
    });
  }

  function proposeSuccession(coverage: Record<string, unknown>) {
    if (!successionOwnerId) return;
    startTransition(async () => {
      const result = await proposeSloOwnerSuccessionAction({
        policyId: String(coverage.policy_id),
        entityId: coverage.entity_id ? String(coverage.entity_id) : null,
        replacementOwnerId: successionOwnerId,
      });
      setMessage(result.ok ? result.message ?? 'Succession proposed' : result.error);
      if (result.ok) router.refresh();
    });
  }

  function runSuccessionDrill(coverage: Record<string, unknown>) {
    if (!successionOwnerId) return;
    startTransition(async () => {
      const result = await runSloOwnerSuccessionDrillAction({
        policyId: String(coverage.policy_id),
        entityId: coverage.entity_id ? String(coverage.entity_id) : null,
        candidateReplacementId: successionOwnerId,
      });
      setMessage(result.ok ? result.message ?? 'Drill recorded' : result.error);
      if (result.ok) router.refresh();
    });
  }

  function archiveExpiredExports() {
    startTransition(async () => {
      const result = await archiveExpiredSloExportsAction();
      setMessage(result.ok ? result.message ?? 'Archived' : result.error);
      if (result.ok) router.refresh();
    });
  }

  function suggestHandoffs() {
    startTransition(async () => {
      const result = await suggestSloOwnerHandoffsAction();
      setMessage(result.ok ? result.message ?? 'Suggestions recorded' : result.error);
      if (result.ok) router.refresh();
    });
  }

  function resolveHandoff(
    suggestionId: string,
    status: 'accepted' | 'dismissed',
  ) {
    startTransition(async () => {
      const result = await resolveSloOwnerHandoffSuggestionAction({
        suggestionId,
        status,
      });
      setMessage(result.ok ? result.message ?? 'Resolved' : result.error);
      if (result.ok) router.refresh();
    });
  }

  function runNightlyReplay() {
    startTransition(async () => {
      const result = await runSloNightlyScenarioReplayAction();
      setMessage(result.ok ? result.message ?? 'Nightly replay recorded' : result.error);
      if (result.ok) router.refresh();
    });
  }

  function generateHandoffDigest() {
    startTransition(async () => {
      const result = await generateSloOwnerHandoffDigestAction();
      setMessage(result.ok ? result.message ?? 'Digest recorded' : result.error);
      if (result.ok) router.refresh();
    });
  }

  function runFirmWideReplay() {
    startTransition(async () => {
      const result = await runSloFirmWideNightlyReplayAction();
      setMessage(result.ok ? result.message ?? 'Firm-wide replay recorded' : result.error);
      if (result.ok) router.refresh();
    });
  }

  function publishHandoffDigest() {
    startTransition(async () => {
      const result = await publishSloOwnerHandoffDigestAction({
        recipientCount: 0,
        destinationKey: 'ops_alerts',
      });
      setMessage(result.ok ? result.message ?? 'Digest published' : result.error);
      if (result.ok) router.refresh();
    });
  }

  function notifyDigestOwners() {
    startTransition(async () => {
      const result = await notifySloHandoffDigestOwnersAction({
        destinationKey: 'ops_alerts',
      });
      setMessage(result.ok ? result.message ?? 'Owners notified' : result.error);
      if (result.ok) router.refresh();
    });
  }

  function scanOwnershipVisibility() {
    startTransition(async () => {
      const result = await scanSloOwnershipChangeVisibilityAction();
      setMessage(result.ok ? result.message ?? 'Visibility scanned' : result.error);
      if (result.ok) router.refresh();
    });
  }

  function deliverOwnerDigestWebhooks() {
    startTransition(async () => {
      const result = await deliverSloOwnerDigestWebhooksAction();
      setMessage(result.ok ? result.message ?? 'Digest webhooks delivered' : result.error);
      if (result.ok) router.refresh();
    });
  }

  function scanDigestDeliverySlo() {
    startTransition(async () => {
      const result = await scanSloDigestNotificationDeliverySloAction();
      setMessage(result.ok ? result.message ?? 'Delivery SLO scanned' : result.error);
      if (result.ok) router.refresh();
    });
  }

  function scanOwnerDigestDeliverySuccess() {
    startTransition(async () => {
      const result = await scanSloOwnerDigestDeliverySuccessAction();
      setMessage(
        result.ok ? result.message ?? 'Owner digest success SLO scanned' : result.error,
      );
      if (result.ok) router.refresh();
    });
  }

  function recordOwnerDigestWowTrend() {
    startTransition(async () => {
      const result = await recordSloOwnerDigestWowTrendAction();
      setMessage(result.ok ? result.message ?? 'Owner digest WoW trend recorded' : result.error);
      if (result.ok) router.refresh();
    });
  }

  function toggleOwnerSelfServeOptIn(targetOwnerId: string, optedIn: boolean) {
    startTransition(async () => {
      const result = await setSloOwnerDigestSelfServeOptInAction({
        ownerId: targetOwnerId,
        optedIn,
      });
      setMessage(result.ok ? result.message ?? 'Self-serve opt-in updated' : result.error);
      if (result.ok) router.refresh();
    });
  }

  function viewOwnerSelfServeFailures(targetOwnerId: string) {
    startTransition(async () => {
      const result = await listSloOwnerDigestSelfServeFailuresAction({
        ownerId: targetOwnerId,
      });
      setMessage(result.ok ? result.message ?? 'Self-serve failures listed' : result.error);
    });
  }

  function viewOwnerSelfServeTrend(targetOwnerId: string) {
    startTransition(async () => {
      const result = await listSloOwnerDigestSelfServeTrendAction({
        ownerId: targetOwnerId,
      });
      setMessage(result.ok ? result.message ?? 'Self-serve trend chart listed' : result.error);
    });
  }

  function viewFirmDigestAdminSummaryTrend() {
    startTransition(async () => {
      const result = await listSloFirmDigestAdminSummaryTrendAction();
      setMessage(
        result.ok ? result.message ?? 'Firm-wide admin summary trend listed' : result.error,
      );
    });
  }

  const calendarByDay = coverageCalendar.reduce<Record<string, number>>((acc, row) => {
    if (!row.covered) return acc;
    const day = String(row.coverage_day);
    acc[day] = (acc[day] ?? 0) + 1;
    return acc;
  }, {});
  const calendarDays = Object.keys(calendarByDay).sort().slice(0, 14);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">SLO policy administration</h2>
        <p className="text-sm text-muted-foreground">Draft, validate, then publish with a different maker/checker. Every transition is versioned and audited.</p>
      </div>
      <div className="grid gap-3">{activePolicies.map((active) => (
        <PolicyEditor key={active.policy_id} active={active} draft={drafts.find((item) => item.draft_of_policy_id === active.policy_id)} comparison={comparisons.find((item) => item.active_policy_id === active.policy_id)} owners={owners} entities={entities} onMessage={setMessage} />
      ))}</div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Historical policy simulation</CardTitle>
          <CardDescription>COUNTERFACTUAL only. Replays immutable historical evaluations against a frozen draft snapshot and never changes evaluations, alerts, incidents, or delivery.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <select value={simulationDraftId} onChange={(event) => setSimulationDraftId(event.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="">Select draft</option>
              {drafts.map((draft) => <option key={draft.policy_id} value={draft.policy_id}>{draft.service} / {draft.metric_key}</option>)}
            </select>
            <select value={simulationEntityId} onChange={(event) => setSimulationEntityId(event.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="">Firm / no entity</option>
              {entities.map((entity) => <option key={entity.entity_id} value={entity.entity_id}>{entity.canonical_name}</option>)}
            </select>
            <Input type="number" min={1} max={90} value={simulationDays} onChange={(event) => setSimulationDays(Number(event.target.value))} />
            <Button disabled={pending || !simulationDraftId} onClick={requestSimulation}>Queue counterfactual</Button>
          </div>
          {simulations.map((simulation) => (
            <div key={String(simulation.simulation_id)} className="flex flex-wrap items-center gap-2 text-xs">
              <p>
                COUNTERFACTUAL · {String(simulation.status)} · {String(simulation.source_evaluation_count)} immutable evaluations
              </p>
              {simulation.status === 'completed' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => exportSimulation(String(simulation.simulation_id))}
                >
                  Export signed metadata
                </Button>
              ) : null}
            </div>
          ))}
          {simulationExports.map((item) => (
            <div key={String(item.export_id)} className="flex flex-wrap items-center gap-2">
              <p className="break-all font-mono text-[10px] text-muted-foreground">
                EXPORT · {String(item.label)} · {String(item.metadata_digest)} · key{' '}
                {String(item.signature_key_id)}
                {item.retention_days != null
                  ? ` · retain ${String(item.retention_days)}d until ${String(item.retained_until ?? '')}`
                  : ''}
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => auditExportAccess(String(item.export_id))}
              >
                Record view access
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={archiveExpiredExports}
          >
            Archive expired exports
          </Button>
          {archivalReceipts.slice(0, 4).map((receipt) => (
            <p key={String(receipt.receipt_id)} className="font-mono text-[10px] text-muted-foreground">
              ARCHIVED · {String(receipt.archived_at)} · digest {String(receipt.metadata_digest)} ·
              soft-hidden (row retained)
            </p>
          ))}
        </CardContent>
      </Card>
      {ownerCoverage.length ? (
        <Card>
          <CardHeader><CardTitle className="text-sm">Expiring owner coverage</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <select
              value={successionOwnerId}
              onChange={(event) => setSuccessionOwnerId(event.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Replacement owner</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>{ownerLabel(owner)}</option>
              ))}
            </select>
            {ownerCoverage.map((coverage) => (
              <div
                key={`${String(coverage.policy_id)}:${String(coverage.entity_id)}`}
                className="flex flex-wrap items-center gap-2 text-xs"
              >
                <p>
                  {String(coverage.days_remaining)} days · replacement{' '}
                  {coverage.eligible_replacement_named ? 'eligible and named' : 'missing'}
                </p>
                {!coverage.eligible_replacement_named ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending || !successionOwnerId}
                    onClick={() => proposeSuccession(coverage)}
                  >
                    Propose succession
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending || !successionOwnerId}
                  onClick={() => runSuccessionDrill(coverage)}
                >
                  Run succession drill
                </Button>
              </div>
            ))}
            {successionProposals.slice(0, 4).map((proposal) => (
              <p key={String(proposal.proposal_id)} className="font-mono text-[10px] text-muted-foreground">
                SUCCESSION · {String(proposal.proposed_at)} · replacement{' '}
                {String(proposal.replacement_owner_id)} · expires {String(proposal.expires_at)}
              </p>
            ))}
            {successionDrills.slice(0, 4).map((drill) => (
              <p key={String(drill.drill_id)} className="font-mono text-[10px] text-muted-foreground">
                DRILL · {String(drill.drilled_at)} · candidate{' '}
                {String(drill.candidate_replacement_id)} · eligible=
                {String(drill.eligibility_ok)} · live_mutated=
                {String(drill.live_succession_mutated ?? false)}
              </p>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={suggestHandoffs}
            >
              Suggest owner handoffs
            </Button>
            {handoffSuggestions.slice(0, 4).map((suggestion) => (
              <div
                key={String(suggestion.suggestion_id)}
                className="flex flex-wrap items-center gap-2 text-xs"
              >
                <p className="font-mono text-[10px] text-muted-foreground">
                  HANDOFF · {String(suggestion.status)} · eligible=
                  {String(suggestion.eligibility_ok)} · {String(suggestion.reason)}
                </p>
                {suggestion.status === 'suggested' ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        resolveHandoff(String(suggestion.suggestion_id), 'accepted')
                      }
                    >
                      Accept suggestion
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        resolveHandoff(String(suggestion.suggestion_id), 'dismissed')
                      }
                    >
                      Dismiss
                    </Button>
                  </>
                ) : null}
              </div>
            ))}
            {simulationScenarios.slice(0, 4).map((scenario) => (
              <p
                key={String(scenario.scenario_id)}
                className="font-mono text-[10px] text-muted-foreground"
              >
                SCENARIO · {String(scenario.name)} · {String(scenario.window_start)} →{' '}
                {String(scenario.window_end)}
              </p>
            ))}
            {phase44Report ? (
              <p className="text-muted-foreground">
                Phase 44 · scenarios {String(phase44Report.scenarios ?? 0)} · open handoffs{' '}
                {String(phase44Report.handoff_suggestions_open ?? 0)} · revisions 30d{' '}
                {String(phase44Report.policy_revisions_30d ?? 0)}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={runNightlyReplay}
              >
                Run nightly scenario replay
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={generateHandoffDigest}
              >
                Generate handoff digest
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={runFirmWideReplay}
              >
                Run firm-wide nightly replay
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={publishHandoffDigest}
              >
                Publish handoff digest
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={notifyDigestOwners}
              >
                Notify digest owners
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={scanOwnershipVisibility}
              >
                Scan ownership visibility
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={deliverOwnerDigestWebhooks}
              >
                Deliver owner digest webhooks
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={scanDigestDeliverySlo}
              >
                Scan digest delivery SLO
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={scanOwnerDigestDeliverySuccess}
              >
                Scan owner digest success SLO
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={recordOwnerDigestWowTrend}
              >
                Record owner digest WoW trend
              </Button>
              {ownerId ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => toggleOwnerSelfServeOptIn(ownerId, true)}
                  >
                    Opt owner into self-serve failures
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => toggleOwnerSelfServeOptIn(ownerId, false)}
                  >
                    Opt owner out
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => viewOwnerSelfServeFailures(ownerId)}
                  >
                    View my digest failures (self-serve)
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => viewOwnerSelfServeTrend(ownerId)}
                  >
                    View my trend chart (self-serve, pull-only)
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={viewFirmDigestAdminSummaryTrend}
                  >
                    View firm-wide admin summary trend (pull-only)
                  </Button>
                </>
              ) : null}
            </div>
            {nightlyReplayRuns.slice(0, 4).map((run) => (
              <p
                key={String(run.run_id)}
                className="font-mono text-[10px] text-muted-foreground"
              >
                NIGHTLY · {String(run.scheduled_for)} · {String(run.status)} · claimed{' '}
                {String(run.scenarios_claimed)} · ok {String(run.succeeded)} · failed{' '}
                {String(run.failed)} · material {String(run.material_risk_count)}
              </p>
            ))}
            {firmWideReplayRuns.slice(0, 4).map((run) => (
              <p
                key={String(run.run_id)}
                className="font-mono text-[10px] text-muted-foreground"
              >
                FIRM-WIDE · {String(run.scheduled_for)} · {String(run.status)} · claimed{' '}
                {String(run.scenarios_claimed)} · material {String(run.material_risk_count)} ·
                flag {String(run.firm_wide_flag_count)} · ok {String(run.succeeded)} · failed{' '}
                {String(run.failed)}
              </p>
            ))}
            {handoffDigests.slice(0, 4).map((digest) => (
              <p
                key={String(digest.digest_id)}
                className="font-mono text-[10px] text-muted-foreground"
              >
                DIGEST · {String(digest.digest_quarter)} · suggestions{' '}
                {String(digest.suggestion_count)} · expiry {String(digest.expiry_count)} ·
                accepted {String(digest.accepted_count)}
              </p>
            ))}
            {digestPublications.slice(0, 4).map((publication) => (
              <p
                key={String(publication.publication_id)}
                className="font-mono text-[10px] text-muted-foreground"
              >
                PUBLISH · {String(publication.digest_quarter)} ·{' '}
                {String(publication.publish_status)} · recipients{' '}
                {String(publication.recipient_count)} · dest{' '}
                {String(publication.destination_key)}
              </p>
            ))}
            {ownershipChangeAlerts.slice(0, 3).map((alert) => (
              <p
                key={String(alert.alert_id)}
                className="font-mono text-[10px] text-muted-foreground"
              >
                OWNERSHIP · {String(alert.severity)} · {String(alert.window_key)} · expires{' '}
                {String(alert.expires_at ?? '')}
              </p>
            ))}
            {digestNotifications.slice(0, 3).map((notification) => (
              <p
                key={String(notification.notification_id)}
                className="font-mono text-[10px] text-muted-foreground"
              >
                NOTIFY · {String(notification.delivery_status)} · dest{' '}
                {String(notification.destination_key)} · owner{' '}
                {String(notification.owner_id)}
              </p>
            ))}
            {ownershipVisibility.slice(0, 4).map((row) => (
              <p
                key={String(row.visibility_id)}
                className="font-mono text-[10px] text-muted-foreground"
              >
                VISIBILITY · {String(row.alert_kind)} · {String(row.severity)} · window{' '}
                {String(row.handoff_window_start ?? '')}→{String(row.handoff_window_end ?? '')}
              </p>
            ))}
            {phase45Report ? (
              <p className="text-muted-foreground">
                Phase 45 · nightly 30d {String(phase45Report.nightly_replay_runs_30d ?? 0)} ·
                digests {String(phase45Report.handoff_digests ?? 0)} · upcoming ownership{' '}
                {String(phase45Report.upcoming_ownership_change_count ?? 0)}
              </p>
            ) : null}
            {phase46Report ? (
              <p className="text-muted-foreground">
                Phase 46 · firm-wide 30d{' '}
                {String(phase46Report.firm_wide_replay_runs_30d ?? 0)} · publications{' '}
                {String(phase46Report.digest_publications ?? 0)} · ownership alerts{' '}
                {String(phase46Report.ownership_change_alerts_30d ?? 0)} · without handoff{' '}
                {String(
                  phase46Report.upcoming_ownership_change_without_handoff_count ?? 0,
                )}
              </p>
            ) : null}
            {phase47Report ? (
              <p className="text-muted-foreground">
                Phase 47 · digest notifies 30d{' '}
                {String(phase47Report.digest_notifications_30d ?? 0)} · handoff windows{' '}
                {String(phase47Report.upcoming_handoff_window_count ?? 0)} · expiry without
                handoff{' '}
                {String(phase47Report.ownership_expiry_without_handoff_count ?? 0)}
              </p>
            ) : null}
            {digestDeliveries.slice(0, 3).map((delivery) => (
              <p
                key={String(delivery.delivery_id)}
                className="font-mono text-[10px] text-muted-foreground"
              >
                DIGEST DEL · {String(delivery.delivery_status)} · dest{' '}
                {String(delivery.destination_key)} · code{' '}
                {String(delivery.response_code ?? '')}
              </p>
            ))}
            {digestDeliverySlos.slice(0, 3).map((snapshot) => (
              <p
                key={String(snapshot.snapshot_id)}
                className="font-mono text-[10px] text-muted-foreground"
              >
                DIGEST SLO · {String(snapshot.severity)} · dest{' '}
                {String(snapshot.destination_key)} · rate{' '}
                {String(snapshot.success_rate ?? 'n/a')} · ok{' '}
                {String(snapshot.delivered_count)} / fail {String(snapshot.failed_count)}
              </p>
            ))}
            {phase48Report ? (
              <p className="text-muted-foreground">
                Phase 48 · allowlist{' '}
                {String(phase48Report.owner_digest_allowlist_active ?? 0)} · deliveries 30d{' '}
                {String(phase48Report.digest_deliveries_30d ?? 0)} · failed{' '}
                {String(phase48Report.digest_deliveries_failed_30d ?? 0)} · critical SLO{' '}
                {String(phase48Report.delivery_slo_critical_30d ?? 0)}
              </p>
            ) : null}
            {ownerDigestSuccessSlos.slice(0, 3).map((snapshot) => (
              <p
                key={String(snapshot.snapshot_id)}
                className="font-mono text-[10px] text-muted-foreground"
              >
                OWNER DIGEST SLO · {String(snapshot.severity)} · owner{' '}
                {String(snapshot.owner_id).slice(0, 8)} · rate{' '}
                {String(snapshot.success_rate ?? 'n/a')} · ok{' '}
                {String(snapshot.delivered_count)} / fail {String(snapshot.failed_count)}
              </p>
            ))}
            {phase49Report ? (
              <p className="text-muted-foreground">
                Phase 49 · owners tracked 30d{' '}
                {String(phase49Report.owners_tracked_30d ?? 0)} · healthy{' '}
                {String(phase49Report.owners_healthy_30d ?? 0)} · warning{' '}
                {String(phase49Report.owners_warning_30d ?? 0)} · critical{' '}
                {String(phase49Report.owners_critical_30d ?? 0)} · overall rate{' '}
                {String(phase49Report.overall_success_rate_30d ?? 'n/a')}
              </p>
            ) : null}
            {ownerDigestWowTrendSnapshots.slice(0, 3).map((snapshot) => (
              <p
                key={String(snapshot.trend_id)}
                className="font-mono text-[10px] text-muted-foreground"
              >
                WoW TREND · {String(snapshot.trend_direction)} · owner{' '}
                {String(snapshot.owner_id).slice(0, 8)} · current{' '}
                {String(snapshot.current_success_rate ?? 'n/a')} · prior{' '}
                {String(snapshot.prior_success_rate ?? 'n/a')} · delta{' '}
                {String(snapshot.rate_delta ?? 'n/a')}
              </p>
            ))}
            {ownerDigestSelfServeOptIns.slice(0, 3).map((row) => (
              <p
                key={String(row.opt_in_id)}
                className="font-mono text-[10px] text-muted-foreground"
              >
                SELF-SERVE OPT-IN · owner {String(row.owner_id).slice(0, 8)} ·{' '}
                {row.opted_in ? 'opted in' : 'opted out'}
              </p>
            ))}
            {phase50Report ? (
              <p className="text-muted-foreground">
                Phase 50 · improving 30d{' '}
                {String(phase50Report.owners_improving_30d ?? 0)} · stable{' '}
                {String(phase50Report.owners_stable_30d ?? 0)} · declining{' '}
                {String(phase50Report.owners_declining_30d ?? 0)} · opted-in owners{' '}
                {String(phase50Report.owners_opted_in ?? 0)} · full_push{' '}
                {String(phase50Report.full_push ?? false)}
              </p>
            ) : null}
            {phase51Report ? (
              <p className="text-muted-foreground">
                Phase 51 · chart-ready owners{' '}
                {String(phase51Report.chart_ready_owner_count ?? 0)} · owners with any trend{' '}
                {String(phase51Report.owners_with_any_trend_count ?? 0)} · full_push{' '}
                {String(phase51Report.full_push ?? false)}
              </p>
            ) : null}
            {phase52Report ? (
              <p className="text-muted-foreground">
                Phase 52 · firm-wide admin summary · owners aggregated{' '}
                {String(phase52Report.owners_aggregated ?? 0)} · trend{' '}
                {String(phase52Report.trend_direction ?? 'unknown')} · summary points{' '}
                {String(phase52Report.summary_points ?? 0)} · chart ready{' '}
                {String(phase52Report.chart_ready ?? false)} · full_push{' '}
                {String(phase52Report.full_push ?? false)} · pull-only
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {calendarDays.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Owner coverage calendar</CardTitle>
            <CardDescription>Next two weeks of published coverage windows with named replacements.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-xs">
            {calendarDays.map((day) => (
              <Badge key={day} variant="outline">
                {day} · {calendarByDay[day]} covered
              </Badge>
            ))}
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Delivery route test</CardTitle>
          <CardDescription>Creates an isolated, leased TEST job. It never opens, closes, or changes an incident.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <select value={adapter} onChange={(event) => { const next = event.target.value as typeof adapter; setAdapter(next); setDestinationKey(next === 'in_app_owner' ? 'owner' : ''); }} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="in_app_owner">In-app owner</option><option value="webhook">Webhook</option>
            </select>
            <select value={entityId} onChange={(event) => setEntityId(event.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="">Firm-wide</option>{entities.map((entity) => <option key={entity.entity_id} value={entity.entity_id}>{entity.canonical_name}</option>)}
            </select>
            {adapter === 'in_app_owner' ? (
              <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                {owners.filter((owner) =>
                  entityId
                    ? owner.entity_id === entityId ||
                      ['visionary', 'admin', 'service_lead'].includes(owner.role)
                    : owner.entity_id === null ||
                      ['visionary', 'admin'].includes(owner.role),
                ).map((owner) => <option key={owner.id} value={owner.id}>{ownerLabel(owner)}</option>)}
              </select>
            ) : <Input value={destinationKey} onChange={(event) => setDestinationKey(event.target.value)} placeholder="env destination key" />}
            <Button disabled={pending || (adapter === 'in_app_owner' ? !ownerId : !destinationKey)} onClick={requestTest}>Queue TEST</Button>
          </div>
          <div className="space-y-1 text-xs">
            {routeTests.map((test) => <p key={String(test.route_test_id)}>
              TEST · {String(test.adapter)} / {String(test.destination_key)} · {String(test.status)}
              {test.last_result ? ` · ${JSON.stringify(test.last_result)}` : ''}
            </p>)}
          </div>
        </CardContent>
      </Card>
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
    </section>
  );
}
