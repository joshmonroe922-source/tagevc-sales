/**
 * Workbook Integrations registry scaffolds — Planned until LIVE.
 * No API credentials stored; env keys are documentation only.
 */

import type { VmIntegration } from '@/lib/vendor-mgmt/types';

export type ConnectorScaffold = Omit<
  VmIntegration,
  'created_at' | 'updated_at'
> & { env_keys: string[] };

export const VM_CONNECTOR_SCAFFOLDS: ConnectorScaffold[] = [
  {
    id: 'INT-HRIS',
    system_name: 'HRIS (BambooHR / Rippling / Gusto HR)',
    category: 'HRIS',
    direction: 'Inbound',
    entities: 'ALL',
    auth_type: 'OAuth / API key (env)',
    status: 'Planned',
    sync_cadence: 'Hourly',
    owner_emp_id: null,
    primary_objects: 'employees, terminations, hire events',
    env: 'VM_HRIS_LIVE + vendor-specific keys',
    notes: 'Hire → birthright; Terminate → reclaim licenses + deactivate portal admin',
    env_keys: ['VM_HRIS_LIVE', 'HRIS_API_KEY'],
  },
  {
    id: 'INT-IDP-ENTRA',
    system_name: 'Microsoft Entra ID (SSO / IdP)',
    category: 'IdP',
    direction: 'Bidirectional',
    entities: 'ALL',
    auth_type: 'OIDC (OS SSO)',
    status: 'Planned',
    sync_cadence: 'Realtime + nightly reconcile',
    owner_emp_id: null,
    primary_objects: 'users, groups, MFA enrollment',
    env: 'Azure AD app registration (OS auth)',
    notes: 'Portal login SSO+MFA; step-up for contract $ uses session attestation',
    env_keys: ['AZURE_AD_CLIENT_ID', 'AZURE_AD_CLIENT_SECRET'],
  },
  {
    id: 'INT-IDP-GOOGLE',
    system_name: 'Google Workspace IdP',
    category: 'IdP',
    direction: 'Bidirectional',
    entities: 'ALL',
    auth_type: 'OIDC (OS SSO)',
    status: 'Planned',
    sync_cadence: 'Realtime + nightly reconcile',
    owner_emp_id: null,
    primary_objects: 'users, groups, MFA',
    env: 'Google OAuth (OS auth)',
    notes: 'Alternate SSO path; no local passwords',
    env_keys: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  },
  {
    id: 'INT-M365',
    system_name: 'Microsoft 365 / Graph',
    category: 'SaaS',
    direction: 'Bidirectional',
    entities: 'ALL',
    auth_type: 'App + delegated',
    status: 'Planned',
    sync_cadence: 'Daily',
    owner_emp_id: null,
    primary_objects: 'licenses, groups, mailbox',
    env: 'GRAPH_* / existing Intune stack',
    notes: 'Seat reclaim on offboard; license inventory → products',
    env_keys: ['MICROSOFT_GRAPH_CLIENT_ID', 'VM_M365_LIVE'],
  },
  {
    id: 'INT-SLACK',
    system_name: 'Slack',
    category: 'SaaS',
    direction: 'Outbound',
    entities: 'ALL',
    auth_type: 'Bot token (env)',
    status: 'Planned',
    sync_cadence: 'Event',
    owner_emp_id: null,
    primary_objects: 'welcome, offboard alerts',
    env: 'SLACK_BOT_TOKEN',
    notes: 'Welcome bot + license reclaim notices',
    env_keys: ['SLACK_BOT_TOKEN', 'VM_SLACK_LIVE'],
  },
  {
    id: 'INT-QBO',
    system_name: 'QuickBooks Online (AP)',
    category: 'Finance',
    direction: 'Inbound',
    entities: 'ALL',
    auth_type: 'OAuth',
    status: 'Planned',
    sync_cadence: 'Daily',
    owner_emp_id: null,
    primary_objects: 'vendors, bills, payments',
    env: 'QBO_* — link to A&F AP later',
    notes: 'Shadow IT discovery via AP; 1099 portal remains separate',
    env_keys: ['QBO_CLIENT_ID', 'QBO_CLIENT_SECRET', 'VM_QBO_LIVE'],
  },
  {
    id: 'INT-CARDS',
    system_name: 'Corporate cards (Ramp / Brex)',
    category: 'Finance',
    direction: 'Inbound',
    entities: 'ALL',
    auth_type: 'API key (env)',
    status: 'Planned',
    sync_cadence: 'Daily',
    owner_emp_id: null,
    primary_objects: 'transactions, merchants',
    env: 'RAMP_* / BREX_*',
    notes: 'Map spend → vendors; never store card PANs',
    env_keys: ['RAMP_API_KEY', 'VM_CARDS_LIVE'],
  },
];

export function connectorEnvReady(scaffold: ConnectorScaffold): {
  live: boolean;
  missing: string[];
} {
  const liveKey = scaffold.env_keys.find((k) => k.endsWith('_LIVE'));
  const live = liveKey ? process.env[liveKey]?.trim() === '1' : false;
  const missing = scaffold.env_keys.filter(
    (k) => !k.endsWith('_LIVE') && !process.env[k]?.trim(),
  );
  return { live, missing };
}
