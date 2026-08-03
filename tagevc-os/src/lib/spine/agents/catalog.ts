/** Agent catalog from workbook 06_Agents_Catalog (names + jobs). */

export const SPINE_AGENTS = [
  {
    id: 'agent.routing',
    label: 'Lead routing',
    jobs: ['agent.routing'] as const,
    description: 'Website/lead → account+contact bootstrap + org assignment',
  },
  {
    id: 'agent.hierarchy',
    label: 'Org hierarchy',
    jobs: ['account.hierarchy'] as const,
    description: 'Suggest manager/report edges; never auto-confirm',
  },
  {
    id: 'agent.site_research',
    label: 'Site research',
    jobs: ['account.site_research'] as const,
    description: 'Website meta + public signals → suggestions inbox',
  },
  {
    id: 'agent.account_brief',
    label: 'Account brief',
    jobs: [] as const,
    description: 'Copilot brief from graph + evidence (C10)',
  },
  {
    id: 'agent.copilot',
    label: 'Cmd-K copilot',
    jobs: [] as const,
    description: 'Tool-gated search/brief — no send_email / capital DocuSign',
  },
  {
    id: 'agent.dedupe_referee',
    label: 'Dedupe referee',
    jobs: [] as const,
    description: 'Scaffold — merge collisions → suggestions inbox',
  },
  {
    id: 'agent.data_qa',
    label: 'Data QA',
    jobs: [] as const,
    description: 'Scaffold — stale freshness + missing email flags',
  },
] as const;

export type SpineAgentId = (typeof SPINE_AGENTS)[number]['id'];
