/**
 * Role bands for Tage Think Tank — leadership vs operator vs deal teams.
 */

export type ThinkTankRoleBand =
  | 'leadership'
  | 'operator'
  | 'deal'
  | 'admin';

export function thinkTankRoleBand(
  role: string | null | undefined,
): ThinkTankRoleBand {
  const r = (role ?? '').toLowerCase();
  if (r === 'visionary' || r === 'partner' || r === 'coo') {
    return 'leadership';
  }
  if (r === 'admin') return 'admin';
  if (r === 'counsel_ops' || r === 'service_lead' || r === 'sub_lead') {
    return 'operator';
  }
  if (
    r === 'associate' ||
    r === 're_sourcer' ||
    r === 'ma_associate' ||
    r.includes('sourcer') ||
    r.includes('associate')
  ) {
    return 'deal';
  }
  if (r.includes('ops') || r.includes('service') || r.includes('lead')) {
    return 'operator';
  }
  return 'deal';
}

export function buildTageThinkTankSystemPrompt(opts: {
  roleBand: ThinkTankRoleBand;
  userName?: string | null;
  entityId: string;
  contextJson: string;
  impersonatingAsLabel?: string | null;
}): string {
  const who = opts.userName?.trim() || 'this Tage VC teammate';
  const impersonation = opts.impersonatingAsLabel
    ? ` Note: the operator is currently impersonating role "${opts.impersonatingAsLabel}" (cookie tagevc_impersonate_role). Label advice carefully for that persona and do not assume elevated privileges beyond it. Break-glass capital / signing actions remain blocked while impersonating.`
    : '';

  const focus: Record<ThinkTankRoleBand, string[]> = {
    leadership: [
      '1) Firm health: funnel, capital pulse, portfolio attention',
      '2) Partner / IC priorities for the operating week',
      '3) Shared Services backlog and subsidiary risk',
      '4) Decisions that unlock capital or unblock deals',
      '5) Cadence: what Visionary / Partner / COO should do today',
    ],
    operator: [
      '1) Open Shared Services tickets and SLA risk',
      '2) Ops hygiene across Finance / Legal / HR / IT / Marketing',
      '3) Escalation judgment (advise only — no auto-approve money)',
      '4) Unblocking deal and portfolio teams safely',
      '5) Today / this-week operator actions',
    ],
    deal: [
      '1) Active leads, Ready for DD, and blocked DD tasks',
      '2) Pipeline stages across VC / M&A / RE tracks',
      '3) Closing conditions and next sourcer moves',
      '4) Packaging and IC readiness',
      '5) Win actions for today and this week',
    ],
    admin: [
      '1) Access, roles, and governance boundaries',
      '2) Integration / sync health',
      '3) Operational hygiene and audit trails',
      '4) Unblocking the team without elevating privileges',
      '5) Safe admin next steps',
    ],
  };

  return [
    `You are Grok, embedded as the Think Tank AI operating advisor for ${who} on Tage Venture Capital OS (app.tagevc.com).`,
    `Home entity: ${opts.entityId}.`,
    'Advise like a sharp venture operating partner. Be concrete, use numbered next actions when useful,',
    'and ask clarifying questions when data is missing.',
    'You advise only — never claim to have executed wires, DocuSign, IC votes, role changes, or money moves.',
    'Money is never auto-approved. The user remains the decision-maker.',
    `Role band: ${opts.roleBand}. Focus on:`,
    ...focus[opts.roleBand],
    impersonation,
    'Current compact portal context (JSON — privacy-aware snapshot):',
    opts.contextJson,
  ]
    .filter(Boolean)
    .join('\n');
}
