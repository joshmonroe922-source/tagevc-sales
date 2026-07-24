/**
 * Phase 62 — Finance enrichment (portfolio bridge). Fail-soft.
 */

import { listActivePortfolioCompanies } from '@/lib/data/repositories';
import { entityDisplayName } from '@/lib/entities/display-name';
import type { PortfolioBridgeMetric } from '@/lib/shared-services/finance-ops-phase62';

export async function listPortfolioFinanceBridgePhase62(opts?: {
  entityId?: string | null;
}): Promise<PortfolioBridgeMetric[]> {
  try {
    const companies = await listActivePortfolioCompanies();
    const filtered = opts?.entityId
      ? companies.filter((c) => c.entity_id === opts.entityId)
      : companies;
    return filtered.map((c) => ({
      entity_id: c.entity_id,
      company_name: entityDisplayName(c),
      arr_k: c.arr_k,
      net_burn_k: c.net_burn_k,
      cash_k: c.cash_k,
      runway_mo: c.runway_mo,
      source_label: 'Dashboard',
    }));
  } catch {
    return [];
  }
}
