/**
 * Intercompany hub — mgmt fee auto-runs + eliminations (build order step 7).
 */

import { makeJe } from '@/lib/af/ledger/je-engine';
import {
  MGMT_FEE_EXPENSE_GL,
  MGMT_FEE_INCOME_GL,
  DUE_TO_PARENT_GL,
} from '@/lib/af/constants';
import { AF_ENTITIES } from '@/lib/af/master-data';
import { parentDueFromAccount } from '@/lib/af/ledger/je-engine';
import type {
  EntityCode,
  GlBalanceMap,
  JournalEntry,
} from '@/lib/af/types';

export type IcFeeRun = {
  period: string;
  journals: JournalEntry[];
  totalFee: number;
  byEntity: Record<string, number>;
};

/** Default monthly management fee schedule (model reference). */
export const DEFAULT_MGMT_FEE: Record<Exclude<EntityCode, 'TVC'>, number> = {
  R619: 8500,
  SHR: 4200,
  INDA: 3500,
};

export function runMonthlyMgmtFees(input: {
  period: string;
  date?: string;
  fees?: Partial<typeof DEFAULT_MGMT_FEE>;
}): IcFeeRun {
  const fees = { ...DEFAULT_MGMT_FEE, ...input.fees };
  const date = input.date ?? `${input.period}-01`;
  const journals: JournalEntry[] = [];
  const byEntity: Record<string, number> = {};
  let totalFee = 0;

  for (const code of Object.keys(fees) as Array<keyof typeof fees>) {
    const amount = fees[code] ?? 0;
    if (amount <= 0) continue;
    const dueFrom = parentDueFromAccount(code);
    byEntity[code] = amount;
    totalFee += amount;

    // Sub: Dr 6950 / Cr 2450
    journals.push(
      makeJe({
        id: `JE-IC-FEE-${code}-${input.period}`,
        entityCode: code,
        date,
        sourceModule: 'IC',
        sourceId: `mgmt-fee-${input.period}`,
        memo: `Management fee to Tage VC — ${input.period}`,
        lines: [
          { account: MGMT_FEE_EXPENSE_GL, debit: amount, credit: 0 },
          { account: DUE_TO_PARENT_GL, debit: 0, credit: amount },
        ],
      }),
    );

    // Parent: Dr Due From / Cr 4000
    journals.push(
      makeJe({
        id: `JE-IC-FEE-TVC-${code}-${input.period}`,
        entityCode: 'TVC',
        date,
        sourceModule: 'IC',
        sourceId: `mgmt-fee-${code}-${input.period}`,
        memo: `Management fee income from ${code} — ${input.period}`,
        lines: [
          { account: dueFrom, debit: amount, credit: 0 },
          { account: MGMT_FEE_INCOME_GL, debit: 0, credit: amount },
        ],
      }),
    );
  }

  return { period: input.period, journals, totalFee, byEntity };
}

export type IcPair = {
  entityCode: Exclude<EntityCode, 'TVC'>;
  dueFromAccount: string;
  parentDueFrom: number;
  subDueTo: number;
  difference: number;
  eliminated: number;
};

export function computeIcPairs(
  balances: Record<string, GlBalanceMap>,
): IcPair[] {
  return AF_ENTITIES.filter((e) => e.code !== 'TVC').map((e) => {
    const code = e.code as Exclude<EntityCode, 'TVC'>;
    const dueFromAccount = parentDueFromAccount(code);
    const parentDueFrom = balances.TVC?.[dueFromAccount] ?? 0;
    const subDueTo = balances[code]?.[DUE_TO_PARENT_GL] ?? 0;
    const eliminated = Math.min(parentDueFrom, subDueTo);
    return {
      entityCode: code,
      dueFromAccount,
      parentDueFrom,
      subDueTo,
      difference: Math.round((parentDueFrom - subDueTo) * 100) / 100,
      eliminated,
    };
  });
}

export function applyIcFeeToBalances(
  balances: Record<string, GlBalanceMap>,
  run: IcFeeRun,
): Record<string, GlBalanceMap> {
  const next: Record<string, GlBalanceMap> = {};
  for (const [k, v] of Object.entries(balances)) {
    next[k] = { ...v };
  }
  if (!next.TVC) next.TVC = {};

  for (const [code, amount] of Object.entries(run.byEntity)) {
    const dueFrom = parentDueFromAccount(code as EntityCode);
    next.TVC[dueFrom] = (next.TVC[dueFrom] ?? 0) + amount;
    next.TVC[MGMT_FEE_INCOME_GL] =
      (next.TVC[MGMT_FEE_INCOME_GL] ?? 0) + amount;
    if (!next[code]) next[code] = {};
    next[code][MGMT_FEE_EXPENSE_GL] =
      (next[code][MGMT_FEE_EXPENSE_GL] ?? 0) + amount;
    next[code][DUE_TO_PARENT_GL] =
      (next[code][DUE_TO_PARENT_GL] ?? 0) + amount;
  }
  return next;
}
