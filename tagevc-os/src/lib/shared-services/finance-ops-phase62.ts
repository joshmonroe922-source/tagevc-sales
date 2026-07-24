/**
 * Phase 62 — Finance operating depth helpers (templates, IES boundary, enrichment).
 * Extends Phase 55; does not rewrite the control plane.
 */

import { entityDisplayName } from '@/lib/entities/display-name';
import type { FinanceControlPlanePhase55Report } from '@/lib/shared-services/finance-control-plane-phase55';

export const PHASE62_FINANCE_HR_CONTRACT_VERSION = 'phase62-v1' as const;

export type SsRequestTemplate = {
  template_id: string;
  service: 'Finance' | 'HR';
  title: string;
  description: string;
  default_priority: 'P0' | 'P1' | 'P2' | 'P3';
};

export const FINANCE_REQUEST_TEMPLATES: SsRequestTemplate[] = [
  {
    template_id: 'fin_close_help',
    service: 'Finance',
    title: 'Help with month-end close item',
    description:
      'Need support completing a close checklist item (bank rec, AP/AR, intercompany).',
    default_priority: 'P2',
  },
  {
    template_id: 'fin_anomaly_review',
    service: 'Finance',
    title: 'Review finance exception',
    description:
      'Flagged anomaly or variance needs human review before any accounting change.',
    default_priority: 'P1',
  },
  {
    template_id: 'fin_writeback_request',
    service: 'Finance',
    title: 'Request accounting write-back review',
    description:
      'Propose an accounting note or adjustment for dual approval — operator executes in IES.',
    default_priority: 'P1',
  },
];

export const IES_BOUNDARY = {
  systemOfRecord: 'Intuit Enterprise Suite (IES)',
  tageRole: 'Visibility, close cadence, exceptions, and approvals',
  readOnlyToday: [
    'Cash / AR / AP / burn KPI cards (when feed is live)',
    'Close checklist orchestration status',
    'Anomaly and exception visibility',
    'Company financial snapshots from portfolio reporting',
  ],
  controlledWritebackFuture: [
    'Journal adjustment proposals (dual-approve → human executes in IES)',
    'Vendor bill / AR memo notes (dual-approve → human executes in IES)',
    'Close flags (dual-approve → human executes in IES)',
  ],
  neverAutomated: [
    'Money movement',
    'Silent IES writes',
    'Auto-approve of financial mutations',
  ],
} as const;

export type PortfolioBridgeMetric = {
  entity_id: string;
  company_name: string;
  arr_k: number | null;
  net_burn_k: number | null;
  cash_k: number | null;
  runway_mo: number | null;
  source_label: string;
};

export type FinanceOpsEnrichment = {
  portfolio_bridge: PortfolioBridgeMetric[];
  month_end_items: FinanceControlPlanePhase55Report['checklist'];
  year_end_items: FinanceControlPlanePhase55Report['checklist'];
  contract_version: typeof PHASE62_FINANCE_HR_CONTRACT_VERSION;
};

export function splitCloseChecklists(
  checklist: FinanceControlPlanePhase55Report['checklist'],
): { month_end: typeof checklist; year_end: typeof checklist } {
  return {
    month_end: checklist.filter((c) => c.close_kind === 'month_end'),
    year_end: checklist.filter((c) => c.close_kind === 'year_end'),
  };
}

export function financeTicketHref(templateId: string, entityId?: string | null): string {
  const params = new URLSearchParams({
    service: 'Finance',
    template: templateId,
  });
  if (entityId) params.set('entity', entityId);
  return `/shared-services?${params.toString()}#create-ticket`;
}

export function companyFinanceHref(entityId: string): string {
  return `/entities/${entityId}#financials`;
}

export function labelFinanceFeedStatus(status: string): string {
  switch (status) {
    case 'ok':
      return 'Fresh';
    case 'partial':
      return 'Partial';
    case 'missing':
      return 'Waiting on books feed';
    default:
      return 'Unknown';
  }
}

export function enrichSubsidiaryLabels(
  report: FinanceControlPlanePhase55Report,
): FinanceControlPlanePhase55Report {
  return {
    ...report,
    subsidiaries: report.subsidiaries.map((s) => ({
      ...s,
      name: entityDisplayName({
        name: s.name,
        entity_id: s.entity_id,
      }),
    })),
  };
}
