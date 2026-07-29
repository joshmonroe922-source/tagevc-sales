/**
 * Revenue Split Waterfall — Spec - Revenue Split Waterfall.
 * On invoice.paid: cash route → commission 2250 → allocation_ledger by dept.
 */

import { getAllocationProfile } from '@/lib/af/master-data';
import { COMMISSION_LIABILITY_GL } from '@/lib/af/constants';
import type {
  AllocationBucket,
  AllocationLedgerRow,
  EntityCode,
  JeLine,
  WaterfallBucketCode,
} from '@/lib/af/types';

export type WaterfallInput = {
  entityCode: EntityCode;
  invoiceId: string;
  amountPaid: number;
  commissionAmount: number;
  paidAt: string;
  profileVersion?: string;
  scenarioId?: string | null;
};

export type WaterfallResult = {
  allocationLedger: AllocationLedgerRow[];
  commissionJeLines: JeLine[];
  profileVersion: string;
  residualProfit: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function runWaterfall(input: WaterfallInput): WaterfallResult {
  const profile = getAllocationProfile(input.entityCode);
  const version = input.profileVersion ?? `${input.entityCode}-v1`;
  const paid = input.amountPaid;
  const commission = Math.min(Math.max(input.commissionAmount, 0), paid);

  const rows: AllocationLedgerRow[] = [];
  let allocated = 0;

  for (const bucket of profile) {
    if (bucket.plug) continue;
    const amount = bucket.dynamic
      ? commission
      : round2(paid * (bucket.pct ?? 0));
    if (amount <= 0 && !bucket.dynamic) continue;
    allocated = round2(allocated + amount);
    rows.push(ledgerRow(input, bucket, amount, version));
  }

  const profitBucket = profile.find((b) => b.plug || b.bucket === 'PROFIT');
  const residual = round2(Math.max(paid - allocated, 0));
  if (profitBucket) {
    rows.push(ledgerRow(input, profitBucket, residual, version));
  }

  const commissionJeLines: JeLine[] =
    commission > 0
      ? [
          {
            account: '6000',
            debit: commission,
            credit: 0,
            memo: 'Commission expense on paid',
          },
          {
            account: COMMISSION_LIABILITY_GL,
            debit: 0,
            credit: commission,
            memo: 'Protected commission liability 2250',
          },
        ]
      : [];

  return {
    allocationLedger: rows,
    commissionJeLines,
    profileVersion: version,
    residualProfit: residual,
  };
}

function ledgerRow(
  input: WaterfallInput,
  bucket: AllocationBucket,
  amount: number,
  version: string,
): AllocationLedgerRow {
  return {
    id: `AL-${input.invoiceId}-${bucket.bucket}`,
    entityCode: input.entityCode,
    invoiceId: input.invoiceId,
    paidAt: input.paidAt,
    bucket: bucket.bucket as WaterfallBucketCode,
    dept: bucket.dept,
    amount,
    profileVersion: version,
    scenarioId: input.scenarioId ?? null,
  };
}

/** Sum allocation ledger by bucket for an entity. */
export function bucketBalances(
  rows: AllocationLedgerRow[],
  entityCode?: EntityCode,
): Record<WaterfallBucketCode, number> {
  const out = {} as Record<WaterfallBucketCode, number>;
  for (const row of rows) {
    if (entityCode && row.entityCode !== entityCode) continue;
    out[row.bucket] = round2((out[row.bucket] ?? 0) + row.amount);
  }
  return out;
}

/** Profit sub-split: 90% Bank for Investments planning, 10% distributions. */
export function profitSubSplit(profitAmount: number): {
  investments: number;
  distributions: number;
} {
  return {
    investments: round2(profitAmount * 0.9),
    distributions: round2(profitAmount * 0.1),
  };
}
