'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  updateEntityNotesAction,
  updatePortfolioPulseAction,
  type MasterDataActionResult,
} from '@/app/(app)/portfolio/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/ui/empty-state';
import { ENTITY_STATUSES, PORTFOLIO_HEALTH } from '@/lib/types';
import type { Entity, PortfolioCompany } from '@/lib/types';

const selectClassName =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50';

const textareaClassName =
  'flex min-h-[72px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

function ResultBanner({ result }: { result: MasterDataActionResult | null }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!result) {
      setVisible(false);
      return;
    }
    setVisible(true);
    if (result.ok) {
      const t = setTimeout(() => setVisible(false), 4000);
      return () => clearTimeout(t);
    }
  }, [result]);

  if (!result || !visible) return null;
  if (result.ok) {
    return (
      <p className="text-sm text-emerald-700" role="status">
        {result.message ?? 'Saved'}
      </p>
    );
  }
  return (
    <p className="text-sm text-destructive" role="alert">
      {result.error}
    </p>
  );
}

export function PortfolioPulseForm({
  company,
}: {
  company: PortfolioCompany;
}) {
  const [result, action, pending] = useActionState(
    updatePortfolioPulseAction,
    null,
  );

  return (
    <form
      action={action}
      className="space-y-3 rounded-lg border border-border bg-card/40 p-4"
    >
      <input type="hidden" name="portfolio_id" value={company.portfolio_id} />
      <div>
        <p className="text-sm font-medium text-[#3a414f]">Edit portfolio pulse</p>
        <p className="text-xs text-muted-foreground">
          SQL-first · Health, risk, milestone, notes. Financial CORE $ fields
          stay read-only (rollup-safe).
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="health">Health</Label>
          <select
            id="health"
            name="health"
            defaultValue={company.health}
            disabled={pending}
            className={selectClassName}
            required
          >
            {PORTFOLIO_HEALTH.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="coo_owner">COO owner</Label>
          <Input
            id="coo_owner"
            name="coo_owner"
            defaultValue={company.coo_owner ?? ''}
            disabled={pending}
            placeholder="COO — Ops Lead"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="top_risk">Top risk</Label>
        <Input
          id="top_risk"
          name="top_risk"
          defaultValue={company.top_risk ?? ''}
          disabled={pending}
          placeholder="Primary operating risk"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="next_milestone">Next milestone</Label>
        <Input
          id="next_milestone"
          name="next_milestone"
          defaultValue={company.next_milestone ?? ''}
          disabled={pending}
          placeholder="Near-term milestone"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={company.notes ?? ''}
          disabled={pending}
          className={textareaClassName}
          placeholder="Operating notes"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save pulse'}
        </Button>
        <ResultBanner result={result} />
      </div>
    </form>
  );
}

export function PortfolioPulseEmpty({ entityId }: { entityId: string }) {
  return (
    <EmptyState
      className="py-8"
      title="No Portfolio Active row"
      description={`Entity ${entityId} is not on Portfolio Active (RE assets use RE Portfolio). Narrative edits are unavailable until a PF-* row exists.`}
    />
  );
}

export function EntityMasterForm({ entity }: { entity: Entity }) {
  const [result, action, pending] = useActionState(updateEntityNotesAction, null);

  return (
    <form
      action={action}
      className="space-y-3 rounded-lg border border-border bg-card/40 p-4"
    >
      <input type="hidden" name="entity_id" value={entity.entity_id} />
      <div>
        <p className="text-sm font-medium text-[#3a414f]">Edit Entity Master</p>
        <p className="text-xs text-muted-foreground">
          SQL-first · Notes, owners, status. Structural IDs stay read-only.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="entity_status">Status</Label>
          <select
            id="entity_status"
            name="status"
            defaultValue={entity.status}
            disabled={pending}
            className={selectClassName}
          >
            {ENTITY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="entity_coo">COO owner</Label>
          <Input
            id="entity_coo"
            name="coo_owner"
            defaultValue={entity.coo_owner ?? ''}
            disabled={pending}
            placeholder="COO — Ops Lead"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="board_lead">Board lead</Label>
          <Input
            id="board_lead"
            name="board_lead"
            defaultValue={entity.board_lead ?? ''}
            disabled={pending}
            placeholder="Partner"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="entity_notes">Notes</Label>
        <textarea
          id="entity_notes"
          name="notes"
          rows={3}
          defaultValue={entity.notes ?? ''}
          disabled={pending}
          className={textareaClassName}
          placeholder="Entity registry notes"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} variant="secondary">
          {pending ? 'Saving…' : 'Save entity'}
        </Button>
        <ResultBanner result={result} />
      </div>
    </form>
  );
}
