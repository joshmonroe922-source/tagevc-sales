'use client';

import { useActionState } from 'react';
import {
  recordIcDecisionAction,
  type ActionResult,
} from '@/app/(app)/deal-flow/vc/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { IC_DECISIONS } from '@/lib/types';

export function IcDecisionForm({
  icId,
  breakGlassBlocked = false,
}: {
  icId: string;
  breakGlassBlocked?: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    recordIcDecisionAction,
    null,
  );

  if (breakGlassBlocked) {
    return (
      <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-medium text-amber-950">
          IC decisions disabled while impersonating
        </p>
        <p className="text-xs text-amber-900/80">
          Exit impersonation to record Approve / Pass / Defer. This is a
          break-glass safety control.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-lg border border-border bg-card p-4">
      <input type="hidden" name="ic_id" value={icId} />
      <p className="text-sm font-medium">Record IC decision</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="decision">Decision</Label>
          <select
            id="decision"
            name="decision"
            className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
            required
            defaultValue="Approve"
          >
            {IC_DECISIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="actor">Decided by</Label>
          <Input id="actor" name="actor" placeholder="Partner" defaultValue="Partner" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="conditions">Conditions (if any)</Label>
          <Input
            id="conditions"
            name="conditions"
            placeholder="Required when Approve with conditions"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="recommendation">Notes / recommendation</Label>
          <Input id="recommendation" name="recommendation" />
        </div>
      </div>
      {state && !state.ok ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}
      {state?.ok ? (
        <p className="text-sm text-muted-foreground">{state.message}</p>
      ) : null}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Recording…' : 'Log decision'}
      </Button>
    </form>
  );
}
