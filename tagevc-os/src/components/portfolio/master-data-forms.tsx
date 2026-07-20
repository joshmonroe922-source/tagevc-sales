'use client';

import { useActionState } from 'react';
import {
  updateEntityNotesAction,
  updatePortfolioPulseAction,
  type MasterDataActionResult,
} from '@/app/(app)/portfolio/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ENTITY_STATUSES, PORTFOLIO_HEALTH } from '@/lib/types';
import type { Entity, PortfolioCompany } from '@/lib/types';

const selectClassName =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

const textareaClassName =
  'flex min-h-[72px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

function ResultBanner({ result }: { result: MasterDataActionResult | null }) {
  if (!result) return null;
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
    <form action={action} className="space-y-3 rounded-lg border border-border p-4">
      <input type="hidden" name="portfolio_id" value={company.portfolio_id} />
      <div>
        <p className="text-sm font-medium text-[#3a414f]">Edit portfolio pulse</p>
        <p className="text-xs text-muted-foreground">
          SQL-first · Health, risk, milestone, notes (CORE narrative fields).
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="health">Health</Label>
          <select
            id="health"
            name="health"
            defaultValue={company.health}
            className={selectClassName}
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
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="top_risk">Top risk</Label>
        <Input
          id="top_risk"
          name="top_risk"
          defaultValue={company.top_risk ?? ''}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="next_milestone">Next milestone</Label>
        <Input
          id="next_milestone"
          name="next_milestone"
          defaultValue={company.next_milestone ?? ''}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={company.notes ?? ''}
          className={textareaClassName}
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

export function EntityMasterForm({ entity }: { entity: Entity }) {
  const [result, action, pending] = useActionState(updateEntityNotesAction, null);

  return (
    <form action={action} className="space-y-3 rounded-lg border border-border p-4">
      <input type="hidden" name="entity_id" value={entity.entity_id} />
      <div>
        <p className="text-sm font-medium text-[#3a414f]">Edit Entity Master</p>
        <p className="text-xs text-muted-foreground">
          SQL-first · Notes, owners, status (structural IDs stay read-only).
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="entity_status">Status</Label>
          <select
            id="entity_status"
            name="status"
            defaultValue={entity.status}
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
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="board_lead">Board lead</Label>
          <Input
            id="board_lead"
            name="board_lead"
            defaultValue={entity.board_lead ?? ''}
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
          className={textareaClassName}
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
