/**
 * Per-function capability catalog for SSC function homes.
 * Cards/list overview of tools inside each service — not just period tasks.
 */

import type { SscFunction } from '@/lib/shared-services/ssc-checklist/types';

export type SscCapability = {
  id: string;
  title: string;
  description: string;
  /** Absolute path or hash on the current function home. */
  href: string;
  /** Short chip (Live · Period · Admin). */
  badge?: string;
};

function checklistHref(
  functionKey: SscFunction,
  entityId: string | null | undefined,
  extra?: Record<string, string>,
): string {
  const qs = new URLSearchParams({
    function: functionKey,
    scope: entityId ? 'single' : 'parent_subs',
    period: 'monthly',
    time: 'active',
    ...extra,
  });
  if (entityId) qs.set('entity', entityId);
  return `/shared-services/checklists?${qs.toString()}`;
}

function auditsHref(
  functionKey: SscFunction,
  entityId: string | null | undefined,
): string {
  const qs = new URLSearchParams({
    function: functionKey,
    scope: entityId ? 'single' : 'parent_subs',
  });
  if (entityId) qs.set('entity', entityId);
  return `/shared-services/audits?${qs.toString()}`;
}

function withEntity(
  path: string,
  entityId: string | null | undefined,
): string {
  if (!entityId) return path;
  const [base, hash = ''] = path.split('#');
  const join = base.includes('?') ? '&' : '?';
  return `${base}${join}entity=${encodeURIComponent(entityId)}${hash ? `#${hash}` : ''}`;
}

const CATALOG: Record<
  SscFunction,
  (entityId: string | null | undefined) => SscCapability[]
> = {
  finance: (entityId) => [
    {
      id: 'fin-checklist',
      title: 'Period checklist',
      description: 'Monthly close cadence · overdue · active tasks.',
      href: checklistHref('finance', entityId),
      badge: 'Period',
    },
    {
      id: 'fin-ies',
      title: 'IES books',
      description: 'Intuit Enterprise Suite pull · cash · AR/AP · sync.',
      href: withEntity('/shared-services/finance#ies-books', entityId),
      badge: 'Live',
    },
    {
      id: 'fin-control',
      title: 'Close & KPI plane',
      description: 'Month/year-end orchestration · KPI pack · exceptions.',
      href: withEntity('/shared-services/finance#finance-control', entityId),
      badge: 'Live',
    },
    {
      id: 'fin-anomalies',
      title: 'Anomalies & write-backs',
      description: 'Alert triage · dual-approve drafts (never auto-money).',
      href: withEntity('/shared-services/finance#finance-anomalies', entityId),
      badge: 'Live',
    },
    {
      id: 'fin-credit',
      title: 'Business credit',
      description: 'Credit monitoring for the firm portfolio.',
      href: '/portfolio/net-worth/credit',
      badge: 'Live',
    },
    {
      id: 'fin-audits',
      title: 'Audits',
      description: 'Startup & annual finance compliance packs.',
      href: auditsHref('finance', entityId),
      badge: 'Period',
    },
  ],
  hr: (entityId) => [
    {
      id: 'hr-checklist',
      title: 'Period checklist',
      description: 'HR cadence · compliance · open period work.',
      href: checklistHref('hr', entityId),
      badge: 'Period',
    },
    {
      id: 'hr-directory',
      title: 'Employee directory',
      description: 'HRIS roster · profiles · status.',
      href: withEntity('/shared-services/hr/employees', entityId),
      badge: 'Live',
    },
    {
      id: 'hr-screening',
      title: 'Screening',
      description: 'Verified First packages · background orders.',
      href: withEntity('/shared-services/hr/screening', entityId),
      badge: 'Live',
    },
    {
      id: 'hr-onboarding',
      title: 'Onboarding',
      description: 'Joiner runs · access readiness · checklists.',
      href: withEntity('/shared-services/hr/onboarding', entityId),
      badge: 'Live',
    },
    {
      id: 'hr-offboarding',
      title: 'Offboarding',
      description: 'Leaver runs · revocation · exit evidence.',
      href: withEntity('/shared-services/hr/offboarding', entityId),
      badge: 'Live',
    },
    {
      id: 'hr-manager',
      title: 'Manager desk',
      description: 'Manager self-service for people ops.',
      href: withEntity('/shared-services/hr/manager', entityId),
      badge: 'Live',
    },
    {
      id: 'hr-ops',
      title: 'JML & ops depth',
      description: 'Joiner/mover/leaver packs · ticket bridges.',
      href: withEntity('/shared-services/hr#hr-ops', entityId),
      badge: 'Live',
    },
    {
      id: 'hr-audits',
      title: 'Audits',
      description: 'Startup & annual HR compliance packs.',
      href: auditsHref('hr', entityId),
      badge: 'Period',
    },
  ],
  it: (entityId) => [
    {
      id: 'it-checklist',
      title: 'Period checklist',
      description: 'Security · access · license cadence tasks.',
      href: checklistHref('it', entityId),
      badge: 'Period',
    },
    {
      id: 'it-hardware',
      title: 'Hardware assets',
      description: 'Inventory · warranty · assignments.',
      href: withEntity('/shared-services/it/assets#hardware', entityId),
      badge: 'Live',
    },
    {
      id: 'it-licenses',
      title: 'Software licenses',
      description: 'Seats · renewals · vendor coverage.',
      href: withEntity('/shared-services/it/assets#licenses', entityId),
      badge: 'Live',
    },
    {
      id: 'it-intune',
      title: 'Intune / MDM',
      description: 'Retire · breaker · dual-approve action queue.',
      href: withEntity('/shared-services/it/assets#intune', entityId),
      badge: 'Live',
    },
    {
      id: 'it-jml',
      title: 'IT onboarding / offboarding',
      description: 'Provisioning · revocation · lifecycle events.',
      href: withEntity('/shared-services/it/assets#it-jml', entityId),
      badge: 'Live',
    },
    {
      id: 'it-activity',
      title: 'Activity log',
      description: 'Operational IT trail for this desk.',
      href: '/shared-services/it/activity',
      badge: 'Live',
    },
    {
      id: 'it-hardening',
      title: 'Access hardening',
      description: 'Assignment visibility · revocation evidence · aging.',
      href: withEntity('/shared-services/it/assets#it-hardening', entityId),
      badge: 'Live',
    },
    {
      id: 'it-audits',
      title: 'Audits',
      description: 'Startup & annual IT compliance packs.',
      href: auditsHref('it', entityId),
      badge: 'Period',
    },
  ],
  marketing: (entityId) => [
    {
      id: 'mkt-checklist',
      title: 'Period checklist',
      description: 'Campaign · brand · channel cadence tasks.',
      href: checklistHref('marketing', entityId),
      badge: 'Period',
    },
    {
      id: 'mkt-publish',
      title: 'Social & publishing',
      description:
        'Connect accounts · compose once · honest LIVE vs scaffold badges.',
      href: withEntity('/shared-services/marketing#mkt-publish', entityId),
      badge: 'Desk',
    },
    {
      id: 'mkt-campaigns',
      title: 'Campaigns & content',
      description: 'Campaign desk · drafts · approvals.',
      href: withEntity('/shared-services/marketing#mkt-campaigns', entityId),
      badge: 'Live',
    },
    {
      id: 'mkt-brand',
      title: 'Brand voice',
      description: 'Tone · audience · enforcement profiles.',
      href: withEntity('/shared-services/marketing#mkt-brand', entityId),
      badge: 'Live',
    },
    {
      id: 'mkt-analytics',
      title: 'Analytics & attribution',
      description: 'Paid metrics · channel ROI · cohorts.',
      href: withEntity('/shared-services/marketing#mkt-analytics', entityId),
      badge: 'Live',
    },
    {
      id: 'mkt-revenue',
      title: 'Revenue rails',
      description: 'Authoritative revenue · SLOs · ops dashboards.',
      href: withEntity('/shared-services/marketing#mkt-revenue', entityId),
      badge: 'Live',
    },
    {
      id: 'mkt-hardening',
      title: 'Publishing controls',
      description: 'Approval SLA · brand-voice gates · Phase 58.',
      href: withEntity('/shared-services/marketing#mkt-hardening', entityId),
      badge: 'Live',
    },
    {
      id: 'mkt-audits',
      title: 'Audits',
      description: 'Startup & annual marketing compliance packs.',
      href: auditsHref('marketing', entityId),
      badge: 'Period',
    },
  ],
  legal: (entityId) => [
    {
      id: 'leg-checklist',
      title: 'Legal tasks',
      description: 'Period checklists · matters · counsel cadence.',
      href: checklistHref('legal', entityId),
      badge: 'Period',
    },
    {
      id: 'leg-counsel',
      title: 'Counsel desk',
      description: 'Matters · contracts · counsel deadlines for this company.',
      href: withEntity('/shared-services/legal', entityId),
      badge: 'Live',
    },
    {
      id: 'leg-tickets',
      title: 'Legal tickets',
      description: 'Counsel queue in the Ticket Portal inbox.',
      href: '/shared-services?service=Legal',
      badge: 'Live',
    },
    {
      id: 'leg-audits',
      title: 'Audits',
      description: 'Startup & annual legal compliance packs.',
      href: auditsHref('legal', entityId),
      badge: 'Period',
    },
  ],
};

export function getSscFunctionCapabilities(
  functionKey: SscFunction,
  entityId?: string | null,
): SscCapability[] {
  return CATALOG[functionKey](entityId ?? null);
}
