/**
 * Phase 61 — Firm Ops Command Completeness contracts + stubs.
 * Command Center: critical alerts, Visionary/COO/Service Lead queues,
 * stale/breach boards, module quick-nav. Reuses Phase 54–60 evidence.
 */

export const PHASE61_FIRM_OPS_CONTRACT_VERSION = 'phase61-v1' as const;
export const PHASE61_ENTITY_FILTER_HINT = 'ENT-R619';

export type FirmOpsBoardStatus = 'ok' | 'partial' | 'missing' | 'unknown';

export type FirmOpsQueueAudience = 'visionary' | 'coo' | 'service_lead';

export type FirmOpsQueueItem = {
  id: string;
  title: string;
  href: string;
  count: number;
  severity: string;
};

export type FirmOpsActionQueue = {
  snapshot_id: string | null;
  audience: FirmOpsQueueAudience | string;
  open_count: number;
  overdue_count: number;
  queue_items: FirmOpsQueueItem[];
  board_status: FirmOpsBoardStatus | string;
  created_at: string | null;
};

export type FirmOpsModuleLink = {
  module_key: string;
  href: string;
  label: string;
  priority: number;
  link_status: FirmOpsBoardStatus | string;
};

export type FirmOpsCommandPhase61Report = {
  entity_id: string | null;
  critical_count: number;
  warning_count: number;
  info_count: number;
  by_service: Record<string, number>;
  alert_board_status: FirmOpsBoardStatus;
  stale_count: number;
  breach_count: number;
  by_domain: Record<string, number>;
  stale_board_status: FirmOpsBoardStatus | string;
  snapshot_id: string | null;
  captured_at: string | null;
  queues: FirmOpsActionQueue[];
  modules: FirmOpsModuleLink[];
  recent_alerts: Array<Record<string, unknown>>;
  entity_filter_hint: string;
  todo: string;
  money_auto_approve: false;
  firm_ops_command: true;
  contract_version: typeof PHASE61_FIRM_OPS_CONTRACT_VERSION;
};

const DEFAULT_MODULES: FirmOpsModuleLink[] = [
  {
    module_key: 'command_center',
    href: '/command-center',
    label: 'Command Center',
    priority: 1,
    link_status: 'missing',
  },
  {
    module_key: 'deal_flow',
    href: '/deal-flow',
    label: 'Deal Flow',
    priority: 2,
    link_status: 'missing',
  },
  {
    module_key: 'portfolio',
    href: '/dashboard',
    label: 'Portfolio',
    priority: 3,
    link_status: 'missing',
  },
  {
    module_key: 'shared_services',
    href: '/shared-services',
    label: 'Shared Services',
    priority: 4,
    link_status: 'missing',
  },
  {
    module_key: 'finance',
    href: '/shared-services/finance',
    label: 'Finance',
    priority: 5,
    link_status: 'missing',
  },
  {
    module_key: 'legal',
    href: '/shared-services/legal',
    label: 'Legal',
    priority: 6,
    link_status: 'missing',
  },
  {
    module_key: 'marketing',
    href: '/shared-services/marketing',
    label: 'Marketing',
    priority: 7,
    link_status: 'missing',
  },
  {
    module_key: 'firm',
    href: '/firm',
    label: 'Firm',
    priority: 8,
    link_status: 'missing',
  },
  {
    module_key: 'documents',
    href: '/documents',
    label: 'Documents',
    priority: 9,
    link_status: 'missing',
  },
  {
    module_key: 'entities',
    href: '/entities',
    label: 'Entities',
    priority: 10,
    link_status: 'missing',
  },
  {
    module_key: 'recruit619',
    href: '/entities/ENT-R619',
    label: 'Recruit 619',
    priority: 11,
    link_status: 'missing',
  },
  {
    module_key: 'activity',
    href: '/activity',
    label: 'Activity',
    priority: 12,
    link_status: 'missing',
  },
  {
    module_key: 'messages',
    href: '/messages',
    label: 'Messages',
    priority: 13,
    link_status: 'missing',
  },
  {
    module_key: 'settings',
    href: '/settings/notifications',
    label: 'Notification prefs',
    priority: 14,
    link_status: 'missing',
  },
];

export function emptyFirmOpsCommandPhase61Report(
  entityId: string | null = null,
): FirmOpsCommandPhase61Report {
  return {
    entity_id: entityId,
    critical_count: 0,
    warning_count: 0,
    info_count: 0,
    by_service: {},
    alert_board_status: 'missing',
    stale_count: 0,
    breach_count: 0,
    by_domain: {},
    stale_board_status: 'missing',
    snapshot_id: null,
    captured_at: null,
    queues: [],
    modules: DEFAULT_MODULES,
    recent_alerts: [],
    entity_filter_hint: PHASE61_ENTITY_FILTER_HINT,
    // TODO: Refresh Firm Ops command after Phase 54–60 boards are current.
    todo: 'Refresh Firm Ops command board; clear critical alerts and SLA breaches; keep Visionary/COO/Service Lead queues current',
    money_auto_approve: false,
    firm_ops_command: true,
    contract_version: PHASE61_FIRM_OPS_CONTRACT_VERSION,
  };
}

export function boardStatusLabel(status: string): string {
  if (status === 'ok') return 'OK';
  if (status === 'partial') return 'Partial';
  if (status === 'missing') return 'Missing';
  return 'Unknown';
}

export function audienceLabel(audience: string): string {
  if (audience === 'visionary') return 'Visionary';
  if (audience === 'coo') return 'COO';
  if (audience === 'service_lead') return 'Service Leads';
  return audience;
}

export function severityLabel(severity: string): string {
  if (severity === 'critical') return 'Critical';
  if (severity === 'warning') return 'Warning';
  if (severity === 'info') return 'Info';
  return severity;
}
