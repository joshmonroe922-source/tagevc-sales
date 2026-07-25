import type { ForbidAction } from '@/lib/types';

/**
 * Shared Services Operating Model §7D — NEVER AUTO.
 * Even at 99% confidence, forbid-list types stay human.
 * Enforce in API / policy engine (this module).
 */
export type ForbidRule = {
  code: ForbidAction;
  label: string;
  human_required: string;
  /** Keywords / phrases that flag this forbid action in ticket text. */
  signals: string[];
};

export const FORBID_LIST: ForbidRule[] = [
  {
    code: 'capital_wire',
    label: 'Capital deploy / wires / dual-control pay',
    human_required: 'Finance (+ Visionary as required)',
    signals: [
      'wire',
      'wiring',
      'wire funds',
      'capital deploy',
      'send money',
      'dual-control',
      'ach payment',
      'pay vendor over threshold',
    ],
  },
  {
    code: 'portfolio_health_change',
    label: 'Set/change Health on Portfolio Active',
    human_required: 'COO only',
    signals: [
      'set health',
      'change health',
      'mark at risk',
      'mark critical',
      'health status',
      'portfolio health',
    ],
  },
  {
    code: 'docusign_capital_send',
    label: 'DocuSign Send on capital docs (TS/SPA/PSA/wire)',
    human_required: 'Counsel/Partner Send',
    signals: [
      'docusign send',
      'send term sheet',
      'send spa',
      'send psa',
      'capital docusign',
      'envelope send',
    ],
  },
  {
    code: 'core_standard_change',
    label: 'CORE standard changes',
    human_required: 'Visionary exception',
    signals: [
      'change core',
      'core kpi',
      'core standard',
      'remove core',
      'core exception',
    ],
  },
  {
    code: 'external_founder_investor_email',
    label: 'External email to founders/investors without approve',
    human_required: 'Partner/Associate',
    signals: [
      'email founder',
      'email investor',
      'send to founder',
      'lp email',
      'outbound to company',
    ],
  },
  {
    code: 'ic_approve',
    label: 'IC approve / go-no-go',
    human_required: 'Partners',
    signals: [
      'ic approve',
      'investment committee',
      'go no-go',
      'go/no-go',
      'vote to invest',
    ],
  },
  {
    code: 'silent_close_p0',
    label: 'Silent-close P0 / security without human ack',
    human_required: 'Service Lead + COO',
    signals: [
      'silent close',
      'auto-close p0',
      'close security without',
      'dismiss p0',
    ],
  },
  {
    code: 'role_permission_change',
    label: 'Role / permission grants or revokes',
    human_required: 'Visionary / Admin',
    signals: [
      'grant role',
      'change role',
      'permission grant',
      'make visionary',
      'promote to admin',
      'revoke access',
    ],
  },
  {
    code: 'hr_termination',
    label: 'Employee termination / offboarding destructive',
    human_required: 'HR + Visionary',
    signals: [
      'terminate employee',
      'fire employee',
      'immediate offboard',
      'disable all access permanently',
    ],
  },
  {
    code: 'credit_file_write',
    label: 'Personal or business credit file mutation',
    human_required: 'Visionary (personal) / finance (business)',
    signals: [
      'dispute credit',
      'file dispute',
      'change credit score',
      'overwrite fico',
      'delete credit snapshot',
    ],
  },
  {
    code: 'secret_env_change',
    label: 'Production secret / env credential change',
    human_required: 'Visionary / Admin',
    signals: [
      'rotate api key',
      'change production secret',
      'update env secret',
      'overwrite service role',
    ],
  },
  {
    code: 'data_deletion',
    label: 'Irreversible data deletion',
    human_required: 'Visionary',
    signals: [
      'hard delete',
      'purge database',
      'drop table',
      'wipe production data',
    ],
  },
];

export function detectForbidHits(text: string): ForbidAction[] {
  const hay = text.toLowerCase();
  const hits: ForbidAction[] = [];
  for (const rule of FORBID_LIST) {
    if (rule.signals.some((s) => hay.includes(s.toLowerCase()))) {
      hits.push(rule.code);
    }
  }
  return hits;
}

export function forbidLabel(code: ForbidAction): string {
  return FORBID_LIST.find((r) => r.code === code)?.label ?? code;
}
