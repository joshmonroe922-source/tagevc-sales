/**
 * Cash routing — Spec - Cash Routing | MD - Bank Accounts.
 * All invoice payments deposit to Operating GL 1000.
 */

import { getOperatingBank } from '@/lib/af/master-data';
import { OPERATING_GL, UNDEPOSITED_GL } from '@/lib/af/constants';
import type { EntityCode, JeLine } from '@/lib/af/types';

export type DepositRoute = {
  entityCode: EntityCode;
  depositGl: string;
  bankAccountId: string;
  revenueAccount: string;
};

/** SKU → revenue account (not bank). Deposit always Operating. */
const SKU_REVENUE: Record<string, string> = {
  'R619-DH': '4210',
  'R619-CT': '4220',
  'SHR-HR': '4310',
  'SHR-FRAC': '4320',
  'INDA-SAAS': '4410',
  'TVC-MGMT': '4000',
  'TVC-SS': '4100',
};

export function resolveDepositRoute(
  entityCode: EntityCode,
  sku: string,
): DepositRoute {
  const bank = getOperatingBank(entityCode);
  return {
    entityCode,
    depositGl: OPERATING_GL,
    bankAccountId: bank?.id ?? `BA-${entityCode}-OP`,
    revenueAccount: SKU_REVENUE[sku] ?? defaultRevenue(entityCode),
  };
}

function defaultRevenue(entityCode: EntityCode): string {
  switch (entityCode) {
    case 'R619':
      return '4210';
    case 'SHR':
      return '4310';
    case 'INDA':
      return '4410';
    default:
      return '4200';
  }
}

/** INV-PAID cash leg: Dr Operating 1000 / Cr AR 1100. */
export function buildInvoicePaidCashLines(
  amount: number,
  opts?: { useUndeposited?: boolean },
): JeLine[] {
  const cashGl = opts?.useUndeposited ? UNDEPOSITED_GL : OPERATING_GL;
  return [
    { account: cashGl, debit: amount, credit: 0, memo: 'Invoice payment deposit' },
    { account: '1100', debit: 0, credit: amount, memo: 'Clear AR' },
  ];
}

/** Free ops cash ≈ Operating − AP due − payroll due − 2250 − pending sweeps. */
export function estimateFreeCash(input: {
  operatingBalance: number;
  apDue: number;
  payrollDue: number;
  commissionLiability: number;
  pendingSweeps: number;
}): number {
  return (
    input.operatingBalance -
    input.apDue -
    input.payrollDue -
    input.commissionLiability -
    input.pendingSweeps
  );
}
