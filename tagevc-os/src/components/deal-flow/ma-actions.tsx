'use client';

import { useActionState } from 'react';
import {
  changeMaStageAction,
  createMaTargetAction,
  setMaTaskStatusAction,
  type ActionResult,
} from '@/app/(app)/deal-flow/ma/actions';
import {
  TrackStageSelect,
  TrackTaskStatusSelect,
} from '@/components/deal-flow/track-controls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  MA_DEAL_TYPES,
  MA_STAGES,
  PRIORITIES,
  type MaStage,
  type TaskStatus,
} from '@/lib/types';

export function MaStageSelect({
  maId,
  stage,
}: {
  maId: string;
  stage: MaStage;
}) {
  return (
    <TrackStageSelect
      value={stage}
      stages={MA_STAGES}
      onChange={(next) => changeMaStageAction(maId, next)}
    />
  );
}

export function MaTaskStatusSelect({
  taskId,
  maId,
  status,
}: {
  taskId: string;
  maId: string;
  status: TaskStatus;
}) {
  return (
    <TrackTaskStatusSelect
      taskId={taskId}
      status={status}
      onChange={(id, next) => setMaTaskStatusAction(id, next, maId)}
    />
  );
}

export function CreateMaTargetForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createMaTargetAction,
    null,
  );

  return (
    <form
      action={action}
      className="space-y-4 rounded-lg border border-border bg-card p-4"
    >
      <h2 className="font-heading text-lg font-semibold">Add M&A target</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="company_name">Target company</Label>
          <Input id="company_name" name="company_name" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deal_type">Deal type</Label>
          <select
            id="deal_type"
            name="deal_type"
            className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
            defaultValue="Platform acquisition"
          >
            {MA_DEAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="website">Website</Label>
          <Input id="website" name="website" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sector">Sector</Label>
          <Input id="sector" name="sector" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="source">Source</Label>
          <Input id="source" name="source" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="owner">Owner</Label>
          <Input id="owner" name="owner" defaultValue="Associate" />
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
        <div className="space-y-1.5">
          <Label htmlFor="enterprise_value_m">EV ($m)</Label>
          <Input id="enterprise_value_m" name="enterprise_value_m" type="number" step="0.1" />
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
        {pending ? 'Creating…' : 'Create target'}
      </Button>
    </form>
  );
}
