import type { DealPath, LeadStage, SalesLead } from './types';
import { DEAL_PATHS, STAGES, TERMINAL_STAGES } from './types';

export type DashboardStats = {
  byStage: { stage: LeadStage; count: number }[];
  byPath: { path: DealPath; count: number }[];
  openCount: number;
  wonCount: number;
  lostCount: number;
  passedCount: number;
  conversionRate: number;
  recentLeads: SalesLead[];
};

export function computeDashboard(leads: SalesLead[]): DashboardStats {
  const byStage = STAGES.map((stage) => ({
    stage,
    count: leads.filter((l) => l.stage === stage).length,
  }));

  const byPath = DEAL_PATHS.map((path) => ({
    path,
    count: leads.filter((l) => l.deal_path === path).length,
  }));

  const wonCount = leads.filter((l) => l.stage === 'closed_won').length;
  const lostCount = leads.filter((l) => l.stage === 'closed_lost').length;
  const passedCount = leads.filter((l) => l.stage === 'passed').length;
  const closed = wonCount + lostCount + passedCount;
  const openCount = leads.filter((l) => !TERMINAL_STAGES.has(l.stage)).length;

  return {
    byStage,
    byPath,
    openCount,
    wonCount,
    lostCount,
    passedCount,
    conversionRate: closed === 0 ? 0 : Math.round((wonCount / closed) * 100),
    recentLeads: [...leads]
      .sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      )
      .slice(0, 8),
  };
}
