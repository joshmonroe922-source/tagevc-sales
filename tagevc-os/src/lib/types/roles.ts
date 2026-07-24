/**
 * RBAC personas from Portal Architecture / Platform Spec.
 */

export const APP_ROLES = [
  'visionary',
  'partner',
  'associate',
  're_sourcer',
  'ma_associate',
  'coo',
  'sub_lead',
  'service_lead',
  'counsel_ops',
  'admin',
] as const;

export type AppRole = (typeof APP_ROLES)[number];

export const APP_ROLE_LABELS: Record<AppRole, string> = {
  visionary: 'Visionary',
  partner: 'Partner',
  associate: 'Associate / VC Sourcer',
  re_sourcer: 'RE Sources',
  ma_associate: 'M&A Associate',
  coo: 'COO (Subsidiaries)',
  sub_lead: 'Subsidiary Leader',
  service_lead: 'Service Lead',
  counsel_ops: 'Counsel / Ops',
  admin: 'Admin',
};

/** Navigation module keys (Platform Spec M0–M8). */
export const NAV_MODULES = [
  'command_center',
  'messages',
  'deal_flow_vc',
  'deal_flow_ma',
  'deal_flow_re',
  'portfolio',
  'shared_services',
  'firm',
  'documents',
  'admin',
] as const;

export type NavModule = (typeof NAV_MODULES)[number];

export type Permission =
  | 'read:command_center'
  | 'read:messages'
  | 'write:messages'
  | 'read:vc_pipeline'
  | 'write:vc_pipeline'
  | 'read:ma_pipeline'
  | 'write:ma_pipeline'
  | 'read:re_pipeline'
  | 'write:re_pipeline'
  | 'read:portfolio'
  | 'write:portfolio_health'
  | 'read:shared_services'
  | 'write:shared_services'
  | 'read:firm'
  | 'write:capital'
  | 'read:documents'
  | 'write:documents'
  | 'read:it_assets'
  | 'write:it_assets'
  | 'read:marketing'
  | 'write:marketing'
  | 'admin:users'
  | 'admin:enums'
  | 'action:ic_vote'
  | 'action:wire'
  | 'action:docusign_capital'
  | 'action:docusign_manual_review'
  | 'action:docusign_reconcile'
  | 'action:intune_retire'
  | 'action:intune_manual_review'
  | 'action:snapshot_rollback_attest';

const ALL_READ: Permission[] = [
  'read:command_center',
  'read:messages',
  'read:vc_pipeline',
  'read:ma_pipeline',
  'read:re_pipeline',
  'read:portfolio',
  'read:shared_services',
  'read:firm',
  'read:documents',
];

/** Role → permission map (high-level Phase 0; refine per workflow). */
export const ROLE_PERMISSIONS: Record<AppRole, Permission[]> = {
  visionary: [
    ...ALL_READ,
    'write:messages',
    'write:vc_pipeline',
    'write:ma_pipeline',
    'write:re_pipeline',
    'write:shared_services',
    'write:documents',
    'read:it_assets',
    'write:it_assets',
    'read:marketing',
    'write:marketing',
    'write:capital',
    'write:portfolio_health',
    'action:ic_vote',
    'action:wire',
    'action:docusign_capital',
    'action:docusign_manual_review',
    'action:docusign_reconcile',
    'action:intune_retire',
    'action:intune_manual_review',
    'action:snapshot_rollback_attest',
    'admin:users',
    'admin:enums',
  ],
  partner: [
    ...ALL_READ,
    'write:messages',
    'write:vc_pipeline',
    'write:ma_pipeline',
    'write:re_pipeline',
    'action:ic_vote',
    'write:documents',
    'read:it_assets',
    'read:marketing',
  ],
  associate: [
    'read:command_center',
    'read:messages',
    'write:messages',
    'read:vc_pipeline',
    'write:vc_pipeline',
    'read:documents',
    'write:documents',
  ],
  re_sourcer: [
    'read:command_center',
    'read:messages',
    'write:messages',
    'read:re_pipeline',
    'write:re_pipeline',
    'read:documents',
  ],
  ma_associate: [
    'read:command_center',
    'read:messages',
    'write:messages',
    'read:ma_pipeline',
    'write:ma_pipeline',
    'read:documents',
  ],
  coo: [
    'read:command_center',
    'read:messages',
    'write:messages',
    'read:portfolio',
    'write:portfolio_health',
    'read:shared_services',
    'write:shared_services',
    'read:firm',
    'read:documents',
    'read:it_assets',
    'write:it_assets',
    'read:marketing',
    'write:marketing',
    'action:intune_retire',
    'action:intune_manual_review',
  ],
  sub_lead: [
    'read:command_center',
    'read:messages',
    'write:messages',
    'read:portfolio',
    'read:documents',
    'write:documents',
    'read:it_assets',
    'read:marketing',
  ],
  service_lead: [
    'read:command_center',
    'read:messages',
    'write:messages',
    'read:shared_services',
    'write:shared_services',
    'read:documents',
    'read:it_assets',
    'write:it_assets',
    'read:marketing',
    'write:marketing',
  ],
  counsel_ops: [
    'read:command_center',
    'read:messages',
    'write:messages',
    'read:vc_pipeline',
    'read:ma_pipeline',
    'read:re_pipeline',
    'read:documents',
    'write:documents',
    'action:wire',
    'action:docusign_manual_review',
    'action:docusign_reconcile',
    'read:it_assets',
  ],
  admin: [
    ...ALL_READ,
    'write:messages',
    'write:vc_pipeline',
    'write:ma_pipeline',
    'write:re_pipeline',
    'write:portfolio_health',
    'write:shared_services',
    'write:capital',
    'write:documents',
    'read:it_assets',
    'write:it_assets',
    'read:marketing',
    'write:marketing',
    'admin:users',
    'admin:enums',
    'action:docusign_manual_review',
    'action:docusign_reconcile',
    'action:intune_retire',
    'action:intune_manual_review',
    'action:snapshot_rollback_attest',
  ],
};

export function roleHasPermission(role: AppRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function roleCanAccessModule(role: AppRole, module: NavModule): boolean {
  const map: Record<NavModule, Permission> = {
    command_center: 'read:command_center',
    messages: 'read:messages',
    deal_flow_vc: 'read:vc_pipeline',
    deal_flow_ma: 'read:ma_pipeline',
    deal_flow_re: 'read:re_pipeline',
    portfolio: 'read:portfolio',
    shared_services: 'read:shared_services',
    firm: 'read:firm',
    documents: 'read:documents',
    admin: 'admin:users',
  };
  return roleHasPermission(role, map[module]);
}
