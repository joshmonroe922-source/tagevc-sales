/** Hire financial impact — fully loaded cost + monthly budget curve. */

export type HireRoleCostTemplate = {
  id: string;
  entity_id: string;
  role_key: string;
  title: string;
  level_label: string;
  base_salary_annual: number;
  burden_pct: number;
  tools_annual: number;
  recruiting_one_time: number;
  notes: string | null;
  active: boolean;
};

export type HireImpactScenario = {
  id: string;
  entity_id: string;
  title: string;
  template_id: string | null;
  role_title: string;
  manager_profile_id: string | null;
  hris_employee_id: string | null;
  headcount: number;
  start_month: string;
  months: number;
  base_salary_annual: number;
  burden_pct: number;
  tools_annual: number;
  recruiting_one_time: number;
  status: 'draft' | 'planned' | 'approved' | 'hired' | 'cancelled';
  assumptions_locked: boolean;
  notes: string | null;
};

export type MonthlyHireImpact = {
  monthKey: string; // YYYY-MM
  salary: number;
  burden: number;
  tools: number;
  recruiting: number;
  total: number;
  cumulative: number;
};

export function fullyLoadedAnnual(input: {
  base_salary_annual: number;
  burden_pct: number;
  tools_annual: number;
  headcount?: number;
}): number {
  const hc = input.headcount ?? 1;
  const salary = input.base_salary_annual * hc;
  const burden = salary * input.burden_pct;
  const tools = input.tools_annual * hc;
  return salary + burden + tools;
}

export function buildMonthlyImpact(input: {
  start_month: string; // YYYY-MM-DD or YYYY-MM
  months: number;
  base_salary_annual: number;
  burden_pct: number;
  tools_annual: number;
  recruiting_one_time: number;
  headcount?: number;
}): MonthlyHireImpact[] {
  const hc = input.headcount ?? 1;
  const start = parseMonthStart(input.start_month);
  const monthlySalary = (input.base_salary_annual * hc) / 12;
  const monthlyBurden = monthlySalary * input.burden_pct;
  const monthlyTools = (input.tools_annual * hc) / 12;
  const recruiting = input.recruiting_one_time * hc;

  const out: MonthlyHireImpact[] = [];
  let cumulative = 0;
  for (let i = 0; i < input.months; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const recruitingThis = i === 0 ? recruiting : 0;
    const total = monthlySalary + monthlyBurden + monthlyTools + recruitingThis;
    cumulative += total;
    out.push({
      monthKey,
      salary: round2(monthlySalary),
      burden: round2(monthlyBurden),
      tools: round2(monthlyTools),
      recruiting: round2(recruitingThis),
      total: round2(total),
      cumulative: round2(cumulative),
    });
  }
  return out;
}

function parseMonthStart(raw: string): Date {
  const s = raw.trim();
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [y, m] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1));
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}
