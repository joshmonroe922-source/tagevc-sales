/** Startup + annual audit item libraries. */

import type { SscAuditItemTemplate, SscAuditType } from './types';

function i(
  partial: SscAuditItemTemplate,
): SscAuditItemTemplate {
  return partial;
}

const STARTUP: SscAuditItemTemplate[] = [
  i({
    key: 'su.fin.setup',
    title: 'Finance setup readiness',
    description: 'Banking, chart of accounts, close cadence, KPI pack wired.',
    function_key: 'finance',
    owner_role: 'service_lead',
    risk_level: 'critical',
  }),
  i({
    key: 'su.fin.banking',
    title: 'Banking / systems / integrations readiness',
    description: 'Banking links and finance integrations confirmed or ticketed.',
    function_key: 'finance',
    owner_role: 'service_lead',
    risk_level: 'high',
  }),
  i({
    key: 'su.hr.roster',
    title: 'HR / roster / access readiness',
    description: 'Roster, JML paths, and access onboarding ready.',
    function_key: 'hr',
    owner_role: 'service_lead',
    risk_level: 'critical',
  }),
  i({
    key: 'su.it.identity',
    title: 'IT / identity / security readiness',
    description: 'Identity, MDM/Intune path, and security baseline ready.',
    function_key: 'it',
    owner_role: 'service_lead',
    risk_level: 'critical',
  }),
  i({
    key: 'su.mkt.brand',
    title: 'Marketing brand / channel readiness',
    description: 'Brand voice, channels, and approval path ready.',
    function_key: 'marketing',
    owner_role: 'service_lead',
    risk_level: 'normal',
  }),
  i({
    key: 'su.leg.entity',
    title: 'Legal / entity / compliance readiness',
    description: 'Entity docs, DocuSign templates, compliance baseline ready.',
    function_key: 'legal',
    owner_role: 'counsel_ops',
    risk_level: 'critical',
  }),
  i({
    key: 'su.cross.docs',
    title: 'Documentation completeness',
    description: 'Operating docs, contacts, and SSC onboarding notes complete.',
    function_key: 'cross',
    owner_role: 'coo',
    risk_level: 'high',
  }),
];

const ANNUAL: SscAuditItemTemplate[] = [
  i({
    key: 'an.fin.close_hygiene',
    title: 'Financial close hygiene',
    description: 'Close checklist hygiene and reconciliation evidence.',
    function_key: 'finance',
    owner_role: 'service_lead',
    risk_level: 'critical',
  }),
  i({
    key: 'an.fin.controls',
    title: 'Finance control checks',
    description: 'Key finance controls sampled and evidenced.',
    function_key: 'finance',
    owner_role: 'coo',
    risk_level: 'high',
  }),
  i({
    key: 'an.hr.policy_ack',
    title: 'Policy acknowledgments',
    description: 'Required policy acknowledgments current.',
    function_key: 'hr',
    owner_role: 'service_lead',
    risk_level: 'high',
  }),
  i({
    key: 'an.it.access_recert',
    title: 'Access recertification',
    description: 'Annual access recertification complete.',
    function_key: 'it',
    owner_role: 'service_lead',
    risk_level: 'critical',
  }),
  i({
    key: 'an.it.security_posture',
    title: 'Security posture',
    description: 'Security posture evidence for the year.',
    function_key: 'it',
    owner_role: 'service_lead',
    risk_level: 'critical',
  }),
  i({
    key: 'an.mkt.compliance_sample',
    title: 'Marketing compliance samples',
    description: 'Sample marketing assets for compliance.',
    function_key: 'marketing',
    owner_role: 'service_lead',
    risk_level: 'normal',
  }),
  i({
    key: 'an.leg.compliance_evidence',
    title: 'Legal / compliance evidence',
    description: 'Legal/compliance evidence package complete.',
    function_key: 'legal',
    owner_role: 'counsel_ops',
    risk_level: 'critical',
  }),
  i({
    key: 'an.cross.controls',
    title: 'Cross-function control checks',
    description: 'Firm-wide SSC control checks and residual risk log.',
    function_key: 'cross',
    owner_role: 'coo',
    risk_level: 'high',
  }),
];

export function auditItemLibrary(type: SscAuditType): SscAuditItemTemplate[] {
  return type === 'startup' ? STARTUP : ANNUAL;
}
