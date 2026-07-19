'use client';

import { useActionState } from 'react';
import {
  changeReStageAction,
  createReDealAction,
  setReTaskStatusAction,
  type ActionResult,
} from '@/app/(app)/deal-flow/re/actions';
import {
  TrackStageSelect,
  TrackTaskStatusSelect,
} from '@/components/deal-flow/track-controls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  PRIORITIES,
  RE_ROUTES,
  RE_STAGES,
  type ReStage,
  type TaskStatus,
} from '@/lib/types';

export function ReStageSelect({
  reId,
  stage,
}: {
  reId: string;
  stage: ReStage;
}) {
  return (
    <TrackStageSelect
      value={stage}
      stages={RE_STAGES}
      onChange={(next) => changeReStageAction(reId, next)}
    />
  );
}

export function ReTaskStatusSelect({
  taskId,
  reId,
  status,
}: {
  taskId: string;
  reId: string;
  status: TaskStatus;
}) {
  return (
    <TrackTaskStatusSelect
      taskId={taskId}
      status={status}
      onChange={(id, next) => setReTaskStatusAction(id, next, reId)}
    />
  );
}

export function CreateReDealForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createReDealAction,
    null,
  );

  return (
    <form
      action={action}
      className="space-y-4 rounded-lg border border-border bg-card p-4"
    >
      <h2 className="font-heading text-lg font-semibold">Add RE asset</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="asset_name">Asset / address</Label>
          <Input id="asset_name" name="asset_name" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="route">Route</Label>
          <select
            id="route"
            name="route"
            className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
            defaultValue="Residential"
            required
          >
            {RE_ROUTES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="asset_type">Asset type</Label>
          <Input id="asset_type" name="asset_type" placeholder="SFR / Flex / …" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="market">Market / city</Label>
          <Input id="market" name="market" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ask_k">Ask ($k)</Label>
          <Input id="ask_k" name="ask_k" type="number" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="priority">Priority</Label>
          <select
            id="priority"
            name="priority"
            className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
            defaultValue="Medium"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <Input id="notes" name="notes" />
        </div>
      </div>
      {state && !state.ok ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}
      {state?.ok ? (
        <p className="text-sm text-muted-foreground">{state.message}</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create asset'}
      </Button>
    </form>
  );
}
