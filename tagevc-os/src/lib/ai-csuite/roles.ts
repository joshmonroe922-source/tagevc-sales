/**
 * AI C-Suite role config — Visionary executive intelligence layer.
 * Reports to Visionary. Separate from Think Tank / Home AI.
 */

export const AI_CSUITE_ROLES = [
  'cfo',
  'cto',
  'cmo',
  'chro',
  'clo',
] as const;

export type AiCsuiteRole = (typeof AI_CSUITE_ROLES)[number];

export type AiCsuiteNavRole = AiCsuiteRole | 'hq';

export type AiCsuiteRoleConfig = {
  role: AiCsuiteRole;
  displayName: string;
  shortLabel: string;
  functionKey: 'finance' | 'it' | 'marketing' | 'hr' | 'legal';
  reportsOn: string;
  systemPromptKey: string;
  contextBuilderKey: string;
  href: string;
};

export const AI_CSUITE_ROLE_CONFIG: Record<AiCsuiteRole, AiCsuiteRoleConfig> = {
  cfo: {
    role: 'cfo',
    displayName: 'AI CFO',
    shortLabel: 'CFO',
    functionKey: 'finance',
    reportsOn: 'Cash, close, anomalies, runway, sub financial health, IES',
    systemPromptKey: 'csuite.cfo',
    contextBuilderKey: 'cfo',
    href: '/c-suite/cfo',
  },
  cto: {
    role: 'cto',
    displayName: 'AI CTO',
    shortLabel: 'CTO',
    functionKey: 'it',
    reportsOn:
      'Security, access, uptime, assets/licenses, incidents, integrations',
    systemPromptKey: 'csuite.cto',
    contextBuilderKey: 'cto',
    href: '/c-suite/cto',
  },
  cmo: {
    role: 'cmo',
    displayName: 'AI CMO',
    shortLabel: 'CMO',
    functionKey: 'marketing',
    reportsOn: 'Pipeline quality, campaigns, channel ROI, brand/content ops',
    systemPromptKey: 'csuite.cmo',
    contextBuilderKey: 'cmo',
    href: '/c-suite/cmo',
  },
  chro: {
    role: 'chro',
    displayName: 'AI CHRO',
    shortLabel: 'CHRO',
    functionKey: 'hr',
    reportsOn: 'Headcount, JML, onboarding risk, retention, HR compliance',
    systemPromptKey: 'csuite.chro',
    contextBuilderKey: 'chro',
    href: '/c-suite/chro',
  },
  clo: {
    role: 'clo',
    displayName: 'AI CLO',
    shortLabel: 'CLO',
    functionKey: 'legal',
    reportsOn: 'Matters, contracts, deadlines, DocuSign risk, compliance',
    systemPromptKey: 'csuite.clo',
    contextBuilderKey: 'clo',
    href: '/c-suite/clo',
  },
};

export const AI_CSUITE_NAV_ORDER: AiCsuiteNavRole[] = [
  'hq',
  'cfo',
  'cto',
  'cmo',
  'chro',
  'clo',
];

export function isAiCsuiteRole(value: string): value is AiCsuiteRole {
  return (AI_CSUITE_ROLES as readonly string[]).includes(value);
}

export function getAiCsuiteRoleConfig(role: AiCsuiteRole): AiCsuiteRoleConfig {
  return AI_CSUITE_ROLE_CONFIG[role];
}
