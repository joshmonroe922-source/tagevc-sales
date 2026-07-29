/**
 * Vendor portal + 1099 / W-9 / I-9 (Spec - AP Vendor Portal & Cards §1, §5).
 */

import type { AfBill, BillStatus, EntityCode, HealthStatus } from '@/lib/af/types';

export type VendorTaxStatus = 'w9_on_file' | 'w9_missing' | 'exempt' | 'foreign';

export type AfVendor = {
  id: string;
  entityCode: EntityCode | 'MULTI';
  name: string;
  email: string;
  status: 'Invited' | 'Active' | 'Blocked';
  taxStatus: VendorTaxStatus;
  eligible1099: boolean;
  ytdPayments: number;
  requiresI9: boolean;
  i9OnFile: boolean;
  risk: 'low' | 'medium' | 'high';
};

export type VendorPortalRow = AfVendor & {
  openBills: number;
  openAmount: number;
  payBlocked: boolean;
  blockReason?: string;
  health: HealthStatus;
};

/** Seed vendors aligned to Spec seed fixtures / bill samples. */
export const AF_VENDORS: AfVendor[] = [
  {
    id: 'VEND-01',
    entityCode: 'R619',
    name: 'Cloud Phone Co',
    email: 'billing@cloudphone.example',
    status: 'Active',
    taxStatus: 'w9_on_file',
    eligible1099: true,
    ytdPayments: 1260,
    requiresI9: false,
    i9OnFile: false,
    risk: 'low',
  },
  {
    id: 'VEND-02',
    entityCode: 'TVC',
    name: 'Office Lease LLC',
    email: 'ar@officelease.example',
    status: 'Active',
    taxStatus: 'exempt',
    eligible1099: false,
    ytdPayments: 21000,
    requiresI9: false,
    i9OnFile: false,
    risk: 'low',
  },
  {
    id: 'VEND-03',
    entityCode: 'SHR',
    name: 'Freelance Ops Partner',
    email: 'ops@freelancer.example',
    status: 'Active',
    taxStatus: 'w9_missing',
    eligible1099: true,
    ytdPayments: 0,
    requiresI9: true,
    i9OnFile: false,
    risk: 'medium',
  },
  {
    id: 'VEND-04',
    entityCode: 'INDA',
    name: 'Cloud Infra Hosting',
    email: 'pay@infra.example',
    status: 'Active',
    taxStatus: 'w9_on_file',
    eligible1099: true,
    ytdPayments: 8400,
    requiresI9: false,
    i9OnFile: false,
    risk: 'low',
  },
];

export function payBlockReason(vendor: AfVendor): string | undefined {
  if (vendor.status === 'Blocked') return 'Vendor blocked';
  if (vendor.eligible1099 && vendor.taxStatus === 'w9_missing') {
    return '1099 vendor missing W-9 — pay blocked by policy';
  }
  if (vendor.requiresI9 && !vendor.i9OnFile) {
    return 'I-9 required before first payment';
  }
  return undefined;
}

export function buildVendorPortal(input: {
  bills: AfBill[];
  entityCode?: EntityCode | null;
  vendors?: AfVendor[];
}): VendorPortalRow[] {
  const vendors = input.vendors ?? AF_VENDORS;
  return vendors
    .filter(
      (v) =>
        !input.entityCode ||
        v.entityCode === 'MULTI' ||
        v.entityCode === input.entityCode,
    )
    .map((v) => {
      const bills = input.bills.filter(
        (b) =>
          b.vendorId === v.id &&
          b.status !== 'Paid' &&
          b.status !== 'Rejected',
      );
      const openAmount = bills.reduce(
        (s, b) => s + (b.amount - b.amountPaid),
        0,
      );
      const block = payBlockReason(v);
      let health: HealthStatus = 'On Track';
      if (block) health = 'At Risk';
      else if (v.risk === 'high') health = 'Watch';
      return {
        ...v,
        openBills: bills.length,
        openAmount,
        payBlocked: Boolean(block),
        blockReason: block,
        health,
      };
    });
}

export type ApprovalRuleResult = {
  billId: string;
  levelsRequired: number;
  autoApprove: boolean;
  reason: string;
};

export function evaluateBillApproval(input: {
  bill: AfBill;
  vendor?: AfVendor;
}): ApprovalRuleResult {
  const vendor = input.vendor ?? AF_VENDORS.find((v) => v.id === input.bill.vendorId);
  const amount = input.bill.amount;
  if (amount < 500 && (vendor?.risk ?? 'low') === 'low') {
    return {
      billId: input.bill.id,
      levelsRequired: 0,
      autoApprove: true,
      reason: 'Low-risk under $500 — auto-approve',
    };
  }
  if (amount < 5000) {
    return {
      billId: input.bill.id,
      levelsRequired: 1,
      autoApprove: false,
      reason: 'Entity manager approval',
    };
  }
  return {
    billId: input.bill.id,
    levelsRequired: 2,
    autoApprove: false,
    reason: 'Controller + Finance dual approval (≥ $5,000)',
  };
}

export const BILL_WORKFLOW: BillStatus[] = [
  'Submitted',
  'In Approval',
  'Approved',
  'Scheduled',
  'Paid',
];

export type Form1099Row = {
  vendorId: string;
  vendorName: string;
  entityCode: EntityCode | 'MULTI';
  ytdPayments: number;
  thresholdMet: boolean;
  w9OnFile: boolean;
  status: 'Ready' | 'Needs W-9' | 'Below threshold' | 'Exempt';
};

export function build1099Register(vendors: AfVendor[] = AF_VENDORS): Form1099Row[] {
  return vendors
    .filter((v) => v.eligible1099 || v.taxStatus === 'exempt')
    .map((v) => {
      if (v.taxStatus === 'exempt') {
        return {
          vendorId: v.id,
          vendorName: v.name,
          entityCode: v.entityCode,
          ytdPayments: v.ytdPayments,
          thresholdMet: false,
          w9OnFile: true,
          status: 'Exempt' as const,
        };
      }
      const thresholdMet = v.ytdPayments >= 600;
      const w9OnFile = v.taxStatus === 'w9_on_file';
      let status: Form1099Row['status'] = 'Below threshold';
      if (!thresholdMet) status = 'Below threshold';
      else if (!w9OnFile) status = 'Needs W-9';
      else status = 'Ready';
      return {
        vendorId: v.id,
        vendorName: v.name,
        entityCode: v.entityCode,
        ytdPayments: v.ytdPayments,
        thresholdMet,
        w9OnFile,
        status,
      };
    });
}
