/**
 * Company + Personal Net Worth — Spec - Net Worth.
 * No card UI on NW pages; liabilities as GL totals only.
 */

import { CASH_GLS_BY_ENTITY } from '@/lib/af/constants';
import { AF_ENTITIES } from '@/lib/af/master-data';
import type { EntityCode, GlBalanceMap } from '@/lib/af/types';

export type NwCategory = {
  id: string;
  label: string;
  amount: number;
};

export type EntityNetWorth = {
  entityCode: EntityCode;
  cash: number;
  cashBreakdown: Record<string, number>;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
};

export type ConsolidatedNetWorth = {
  cash: number;
  cashByEntity: Record<EntityCode, number>;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  eliminationsApplied: boolean;
};

export type PersonalNetWorth = {
  categories: NwCategory[];
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  businessOwnership: NwCategory[];
};

const ASSET_PREFIXES = ['1'];
const LIABILITY_PREFIXES = ['2'];

function isAsset(account: string): boolean {
  return ASSET_PREFIXES.some((p) => account.startsWith(p));
}

function isLiability(account: string): boolean {
  return LIABILITY_PREFIXES.some((p) => account.startsWith(p));
}

/** Asset net = debit − credit; liability net for NW = credit − debit. */
export function computeEntityNetWorth(
  entityCode: EntityCode,
  balances: GlBalanceMap,
): EntityNetWorth {
  const cashGls = CASH_GLS_BY_ENTITY[entityCode] ?? ['1000'];
  const cashBreakdown: Record<string, number> = {};
  let cash = 0;
  for (const gl of cashGls) {
    const bal = balances[gl] ?? 0;
    cashBreakdown[gl] = bal;
    cash += bal;
  }

  let totalAssets = 0;
  let totalLiabilities = 0;
  for (const [acct, bal] of Object.entries(balances)) {
    if (isAsset(acct)) totalAssets += bal;
    if (isLiability(acct)) totalLiabilities += Math.abs(bal);
  }

  return {
    entityCode,
    cash,
    cashBreakdown,
    totalAssets,
    totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
  };
}

/**
 * Consolidated NW after IC eliminations (Due From/To cancel).
 * Exclude books_id=PERS always.
 */
export function computeConsolidatedNetWorth(
  byEntity: Record<EntityCode, GlBalanceMap>,
): ConsolidatedNetWorth {
  const cashByEntity = {} as Record<EntityCode, number>;
  let cash = 0;
  let totalAssets = 0;
  let totalLiabilities = 0;

  const icAsset = new Set(['1400', '1410', '1420', '1430']);
  const icLiab = new Set(['2400', '2450']);

  for (const entity of AF_ENTITIES) {
    const nw = computeEntityNetWorth(entity.code, byEntity[entity.code] ?? {});
    cashByEntity[entity.code] = nw.cash;
    cash += nw.cash;

    for (const [acct, bal] of Object.entries(byEntity[entity.code] ?? {})) {
      if (icAsset.has(acct) || icLiab.has(acct)) continue; // elim
      if (isAsset(acct)) totalAssets += bal;
      if (isLiability(acct)) totalLiabilities += Math.abs(bal);
    }
  }

  return {
    cash,
    cashByEntity,
    totalAssets,
    totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
    eliminationsApplied: true,
  };
}

/**
 * Personal NW: asset categories − single liability total.
 * Businesses default = ownership% × entity book NW (no double-count in Combined).
 */
export function computePersonalNetWorth(input: {
  balances: GlBalanceMap;
  entityBookNw: Record<EntityCode, number>;
  ownershipPct?: Record<EntityCode, number>;
}): PersonalNetWorth {
  const b = input.balances;
  const cash =
    (b['1000'] ?? 0) + (b['1010'] ?? 0) + (b['1020'] ?? 0) + (b['1040'] ?? 0);
  const investments = b['1500'] ?? 0;
  const retirement = b['1510'] ?? 0;
  const crypto = b['1520'] ?? 0;
  const otherAssets = (b['1600'] ?? 0) + (b['1530'] ?? 0);
  // 1530 may be used for manual business; we also compute ownership lines

  const ownership = AF_ENTITIES.map((e) => {
    const pct = input.ownershipPct?.[e.code] ?? e.ownershipPct ?? 1;
    const book = input.entityBookNw[e.code] ?? 0;
    return {
      id: `biz-${e.code}`,
      label: `${e.legalName} (${Math.round(pct * 100)}% book)`,
      amount: Math.round(book * pct * 100) / 100,
    };
  });

  const categories: NwCategory[] = [
    { id: 'cash', label: 'Cash & banking', amount: cash },
    { id: 'investments', label: 'Taxable investments', amount: investments },
    { id: 'retirement', label: 'Retirement', amount: retirement },
    { id: 'crypto', label: 'Crypto', amount: crypto },
    {
      id: 'other',
      label: 'Other personal assets',
      amount: Math.max(otherAssets - (b['1530'] ?? 0), 0),
    },
    ...ownership,
  ];

  const totalAssets = categories.reduce((s, c) => s + c.amount, 0);

  let totalLiabilities = 0;
  for (const [acct, bal] of Object.entries(b)) {
    if (isLiability(acct)) totalLiabilities += Math.abs(bal);
  }

  return {
    categories,
    totalAssets,
    totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
    businessOwnership: ownership,
  };
}

/**
 * Visionary Combined: Personal NW (incl business ownership) only —
 * do NOT add company consolidated NW again.
 */
export function computeCombinedView(personal: PersonalNetWorth): {
  netWorth: number;
  note: string;
} {
  return {
    netWorth: personal.netWorth,
    note: 'Combined uses Personal NW including business ownership at book × % — company cash is not added again.',
  };
}
