'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  updateCoreKpiAction,
  updateEntityNotesAction,
  updateFlexKpiAction,
  updatePortfolioCoreFinancialsAction,
  updatePortfolioPulseAction,
  type MasterDataActionResult,
} from '@/app/(app)/portfolio/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/ui/empty-state';
import {
  CORE_KPI_CATALOG,
  EDITABLE_CORE_KPI_KEYS,
  flexKeysForModule,
} from '@/lib/portfolio/core-kpis';
import { ENTITY_STATUSES, PORTFOLIO_HEALTH } from '@/lib/types';
import type {
  Entity,
  EntityMonthKpi,
  EntityMonthKpiFlex,
  PortfolioCompany,
} from '@/lib/types';

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
          SQL-first · Health, risk, milestone, notes. Use CORE financials form
          for ARR / burn / cash (rollup-aligned).
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

export function PortfolioCoreFinancialForm({
  company,
  pnl,
}: {
  company: PortfolioCompany;
  pnl: { cogs_k: number; opex_k: number } | null;
}) {
  const [result, action, pending] = useActionState(
    updatePortfolioCoreFinancialsAction,
    null,
  );
  const momPct =
    company.mom_growth == null
      ? ''
      : String(Math.round(company.mom_growth * 1000) / 10);

  return (
    <form
      action={action}
      className="space-y-3 rounded-lg border border-border bg-card/40 p-4"
    >
      <input type="hidden" name="portfolio_id" value={company.portfolio_id} />
      <div>
        <p className="text-sm font-medium text-[#3a414f]">Edit CORE financials</p>
        <p className="text-xs text-muted-foreground">
          SQL-first · Updates Portfolio Active and same-period P&L so roll-ups
          stay consistent. Leave runway blank to auto-calc from cash ÷ burn.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="arr_k">ARR ($k)</Label>
          <Input
            id="arr_k"
            name="arr_k"
            type="number"
            step="0.1"
            min="0"
            defaultValue={company.arr_k}
            disabled={pending}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="net_burn_k">Net burn ($k)</Label>
          <Input
            id="net_burn_k"
            name="net_burn_k"
            type="number"
            step="0.1"
            min="0"
            defaultValue={company.net_burn_k}
            disabled={pending}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cash_k">Ending cash ($k)</Label>
          <Input
            id="cash_k"
            name="cash_k"
            type="number"
            step="0.1"
            min="0"
            defaultValue={company.cash_k}
            disabled={pending}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="runway_mo">Runway (mo)</Label>
          <Input
            id="runway_mo"
            name="runway_mo"
            type="number"
            step="0.1"
            min="0"
            defaultValue={company.runway_mo ?? ''}
            disabled={pending}
            placeholder="Auto from cash ÷ burn"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mom_growth">MoM growth (%)</Label>
          <Input
            id="mom_growth"
            name="mom_growth"
            type="number"
            step="0.1"
            defaultValue={momPct}
            disabled={pending}
            placeholder="e.g. 12"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cogs_k">COGS ($k)</Label>
          <Input
            id="cogs_k"
            name="cogs_k"
            type="number"
            step="0.1"
            min="0"
            defaultValue={pnl?.cogs_k ?? 0}
            disabled={pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="opex_k">OpEx ($k)</Label>
          <Input
            id="opex_k"
            name="opex_k"
            type="number"
            step="0.1"
            min="0"
            defaultValue={pnl?.opex_k ?? 0}
            disabled={pending}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} variant="secondary">
          {pending ? 'Saving…' : 'Save CORE financials'}
        </Button>
        <ResultBanner result={result} />
      </div>
    </form>
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

export function CoreKpiEditForm({
  entityId,
  kpis,
}: {
  entityId: string;
  kpis: EntityMonthKpi[];
}) {
  const [result, action, pending] = useActionState(updateCoreKpiAction, null);
  const byKey = new Map(kpis.map((k) => [k.kpi_key, k]));
  const editable = CORE_KPI_CATALOG.filter((c) =>
    (EDITABLE_CORE_KPI_KEYS as readonly string[]).includes(c.kpi_key),
  );

  return (
    <form
      action={action}
      className="space-y-3 rounded-lg border border-border bg-card/40 p-4"
    >
      <input type="hidden" name="entity_id" value={entityId} />
      <div>
        <p className="text-sm font-medium text-[#3a414f]">Edit CORE KPIs</p>
        <p className="text-xs text-muted-foreground">
          Non-money CORE facts for this period. ARR / burn / cash / runway use
          CORE financials above.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="kpi_key">KPI</Label>
          <select
            id="kpi_key"
            name="kpi_key"
            disabled={pending}
            className={selectClassName}
            required
            defaultValue={editable[0]?.kpi_key}
          >
            {editable.map((c) => (
              <option key={c.kpi_key} value={c.kpi_key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="kpi_value_num">Value (number)</Label>
          <Input
            id="kpi_value_num"
            name="value_num"
            type="number"
            step="any"
            disabled={pending}
            defaultValue={byKey.get(editable[0]?.kpi_key ?? '')?.value_num ?? ''}
            placeholder="Numeric value"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="kpi_value_text">Value (text)</Label>
          <Input
            id="kpi_value_text"
            name="value_text"
            disabled={pending}
            defaultValue={
              byKey.get(editable[0]?.kpi_key ?? '')?.value_text ?? ''
            }
            placeholder="Optional text (e.g. On Track)"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} variant="secondary">
          {pending ? 'Saving…' : 'Save CORE KPI'}
        </Button>
        <ResultBanner result={result} />
      </div>
    </form>
  );
}

export function FlexKpiEditForm({
  entity,
  kpis,
}: {
  entity: Entity;
  kpis: EntityMonthKpiFlex[];
}) {
  const [result, action, pending] = useActionState(updateFlexKpiAction, null);
  const allowed = flexKeysForModule(entity.industry_module);
  if (allowed.length === 0) {
    return (
      <EmptyState
        className="py-6"
        title="No FLEX playbook"
        description="This entity has no industry_module FLEX keys to edit."
      />
    );
  }
  const byKey = new Map(kpis.map((k) => [k.flex_key, k]));
  const first = allowed[0]!;

  return (
    <form
      action={action}
      className="space-y-3 rounded-lg border border-border bg-card/40 p-4"
    >
      <input type="hidden" name="entity_id" value={entity.entity_id} />
      <div>
        <p className="text-sm font-medium text-[#3a414f]">Edit FLEX KPIs</p>
        <p className="text-xs text-muted-foreground">
          Module {entity.industry_module} · never rolls into Portfolio money
          totals.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="flex_key">FLEX key</Label>
          <select
            id="flex_key"
            name="flex_key"
            disabled={pending}
            className={selectClassName}
            required
            defaultValue={first.flex_key}
          >
            {allowed.map((f) => (
              <option key={f.flex_key} value={f.flex_key}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="flex_value_num">Value (number)</Label>
          <Input
            id="flex_value_num"
            name="value_num"
            type="number"
            step="any"
            disabled={pending}
            defaultValue={byKey.get(first.flex_key)?.value_num ?? ''}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="flex_value_text">Value (text)</Label>
          <Input
            id="flex_value_text"
            name="value_text"
            disabled={pending}
            defaultValue={byKey.get(first.flex_key)?.value_text ?? ''}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} variant="secondary">
          {pending ? 'Saving…' : 'Save FLEX KPI'}
        </Button>
        <ResultBanner result={result} />
      </div>
    </form>
  );
}
