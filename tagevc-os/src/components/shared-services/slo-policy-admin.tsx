'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  exportSloSimulationAction,
  requestSloRouteTestAction,
  requestSloSimulationAction,
  saveSloPolicyDraftAction,
  transitionSloPolicyDraftAction,
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
            <p key={String(item.export_id)} className="break-all font-mono text-[10px] text-muted-foreground">
              EXPORT · {String(item.label)} · {String(item.metadata_digest)} · key {String(item.signature_key_id)}
            </p>
          ))}
        </CardContent>
      </Card>
      {ownerCoverage.length ? (
        <Card>
          <CardHeader><CardTitle className="text-sm">Expiring owner coverage</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {ownerCoverage.map((coverage) => <p key={`${String(coverage.policy_id)}:${String(coverage.entity_id)}`} className="text-xs">
              {String(coverage.days_remaining)} days · replacement {coverage.eligible_replacement_named ? 'eligible and named' : 'missing'}
            </p>)}
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
