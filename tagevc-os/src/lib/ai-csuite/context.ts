/**
 * Fail-soft C-Suite context packs — compact JSON, company display names only.
 * Never invent KPIs when feeds are missing.
 */

import { entityDisplayName } from '@/lib/entities/display-name';
import { listScopedTickets } from '@/lib/data/pipeline-scope';
import { getSscHubGlance } from '@/lib/shared-services/ssc-checklist/hub-glance';
import { getIesFinanceReport } from '@/lib/ies/report';
import { getFinanceControlPlanePhase55Report } from '@/lib/shared-services/finance-control-plane-phase55-server';
import { listPortfolioFinanceBridgePhase62 } from '@/lib/shared-services/finance-ops-phase62-server';
import type { AiCsuiteRole } from '@/lib/ai-csuite/roles';
import { AI_CSUITE_ROLE_CONFIG } from '@/lib/ai-csuite/roles';

export type CsuiteContextPack = {
  role: AiCsuiteRole | 'hq';
  as_of: string;
  scope: 'consolidated' | 'company';
  entity_id: string | null;
  kpis: Array<{ key: string; label: string; value: string | number | null; status: 'live' | 'partial' | 'missing' }>;
  overdue_tasks: Array<Record<string, unknown>>;
  anomalies: Array<Record<string, unknown>>;
  subsidiaries: Array<{ name: string; signals: string[] }>;
  open_tickets: Array<Record<string, unknown>>;
  recent_changes: Array<Record<string, unknown>>;
  data_gaps: string[];
};

const MAX_JSON_CHARS = 12_000;

function capPack(pack: CsuiteContextPack): CsuiteContextPack {
  const raw = JSON.stringify(pack);
  if (raw.length <= MAX_JSON_CHARS) return pack;
  return {
    ...pack,
    recent_changes: pack.recent_changes.slice(0, 3),
    open_tickets: pack.open_tickets.slice(0, 5),
    overdue_tasks: pack.overdue_tasks.slice(0, 8),
    data_gaps: [...pack.data_gaps, 'context truncated for token budget'],
  };
}

async function safeTickets(serviceHint?: string, entityId?: string | null) {
  try {
    const tickets = await listScopedTickets();
    const open = tickets.filter(
      (t) => !['Closed', 'Resolved'].includes(t.status),
    );
    const scoped = entityId
      ? open.filter((t) => t.entity_id === entityId)
      : open;
    const filtered = serviceHint
      ? scoped.filter((t) =>
          String(t.service ?? '')
            .toLowerCase()
            .includes(serviceHint.toLowerCase()),
        )
      : scoped;
    return filtered.slice(0, 8).map((t) => ({
      title: t.title,
      service: t.service,
      priority: t.priority,
      company: entityDisplayName({
        company_name: t.company_name,
        entity_id: t.entity_id,
      }),
    }));
  } catch {
    return null;
  }
}

async function safeGlance() {
  try {
    return await getSscHubGlance();
  } catch {
    return null;
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function basePack(
  role: AiCsuiteRole | 'hq',
  entityId?: string | null,
): CsuiteContextPack {
  return {
    role,
    as_of: new Date().toISOString(),
    scope: entityId ? 'company' : 'consolidated',
    entity_id: entityId ?? null,
    kpis: [],
    overdue_tasks: [],
    anomalies: [],
    subsidiaries: [
      { name: 'Recruit 619', signals: [] },
      { name: 'Instant NDA', signals: [] },
      { name: 'Signent HR', signals: [] },
    ],
    open_tickets: [],
    recent_changes: [],
    data_gaps: [],
  };
}

function upsertSubsidiarySignal(
  pack: CsuiteContextPack,
  name: string,
  signal: string,
) {
  let row = pack.subsidiaries.find(
    (s) => s.name.toLowerCase() === name.toLowerCase(),
  );
  if (!row) {
    row = { name, signals: [] };
    pack.subsidiaries.push(row);
  }
  if (signal && !row.signals.includes(signal)) row.signals.push(signal);
}

export async function buildCfoContext(
  entityId?: string | null,
): Promise<CsuiteContextPack> {
  const pack = basePack('cfo', entityId);
  const FIN_ENRICH_MS = 2500;
  const [tickets, glance, ies, controlPlane, portfolioBridge] =
    await Promise.all([
      safeTickets('Finance', entityId),
      safeGlance(),
      withTimeout(
        getIesFinanceReport({ entityId }).catch(() => null),
        FIN_ENRICH_MS,
        null,
      ),
      withTimeout(
        getFinanceControlPlanePhase55Report({ entityId }).catch(() => null),
        FIN_ENRICH_MS,
        null,
      ),
      withTimeout(
        listPortfolioFinanceBridgePhase62({ entityId }).catch(() => []),
        FIN_ENRICH_MS,
        [],
      ),
    ]);

  if (!tickets) pack.data_gaps.push('finance tickets unavailable');
  else pack.open_tickets = tickets;

  if (!glance) {
    pack.data_gaps.push('SSC finance checklist glance unavailable');
    pack.kpis.push({
      key: 'close_completion',
      label: 'Close / checklist completion',
      value: null,
      status: 'missing',
    });
  } else {
    const fin = glance.functions.find((f) => f.function_key === 'finance');
    pack.kpis.push({
      key: 'close_completion',
      label: 'Finance checklist completion %',
      value: fin?.completion_pct ?? glance.completion_pct,
      status: fin ? 'live' : 'partial',
    });
    pack.overdue_tasks = [
      {
        function: 'finance',
        overdue: fin?.overdue_tasks ?? glance.overdue_tasks,
        blocked: fin ? undefined : glance.blocked_tasks,
        period_key: glance.period_key,
      },
    ];
    if ((fin?.overdue_tasks ?? glance.overdue_tasks ?? 0) > 0) {
      pack.anomalies.push({
        kind: 'overdue_finance_tasks',
        count: fin?.overdue_tasks ?? glance.overdue_tasks,
        title: 'Overdue finance SSC checklist work',
      });
    }
  }

  let iesCashLive = false;
  if (!ies) {
    pack.data_gaps.push(
      'IES finance report unavailable — cash/runway not wired in this pack',
    );
    pack.kpis.push(
      {
        key: 'cash_on_hand',
        label: 'Cash on hand (IES)',
        value: null,
        status: 'missing',
      },
      {
        key: 'runway_mo',
        label: 'Runway months',
        value: null,
        status: 'missing',
      },
    );
  } else {
    if (!ies.configured) {
      pack.data_gaps.push(
        'IES not configured (secrets/OAuth) — cash/runway live feed not attached',
      );
    }
    const company = entityId
      ? ies.companies.find((row) => row.entity_id === entityId)
      : null;
    const cons = company
      ? {
          cash_on_hand: company.cash_on_hand,
          ar_balance: company.ar_balance,
          overdue_invoices: company.overdue_invoices,
          feed_status: company.feed_status,
        }
      : ies.consolidated;
    if (cons.cash_on_hand != null) {
      iesCashLive = true;
      pack.kpis.push({
        key: 'cash_on_hand',
        label: `${company?.company_name ?? 'Consolidated'} cash on hand (IES)`,
        value: cons.cash_on_hand,
        status: cons.feed_status === 'ok' ? 'live' : 'partial',
      });
    } else {
      pack.kpis.push({
        key: 'cash_on_hand',
        label: `${company?.company_name ?? 'Consolidated'} cash on hand (IES)`,
        value: null,
        status: 'missing',
      });
      pack.data_gaps.push(
        'IES cash/runway live feed not attached — advise from known SSC facts only',
      );
    }
    if (cons.ar_balance != null) {
      pack.kpis.push({
        key: 'ar_balance',
        label: 'AR balance (IES)',
        value: cons.ar_balance,
        status: cons.feed_status === 'ok' ? 'live' : 'partial',
      });
    }
    if (cons.overdue_invoices != null) {
      pack.kpis.push({
        key: 'overdue_invoices',
        label: 'Overdue invoices (IES)',
        value: cons.overdue_invoices,
        status: 'live',
      });
      if (cons.overdue_invoices > 0) {
        pack.anomalies.push({
          kind: 'overdue_invoices',
          count: cons.overdue_invoices,
          title: 'Overdue invoice signal from IES',
        });
      }
    }
    if (ies.last_sync) {
      pack.recent_changes.push({
        kind: 'ies_sync',
        status: ies.last_sync.status,
        started_at: ies.last_sync.started_at,
        message: ies.last_sync.message,
      });
    }
    for (const co of ies.companies) {
      const signals: string[] = [];
      if (co.feed_status !== 'missing' && co.cash_on_hand != null) {
        signals.push(`cash=${co.cash_on_hand} (${co.feed_status})`);
      }
      if (co.overdue_invoices != null && co.overdue_invoices > 0) {
        signals.push(`overdue_invoices=${co.overdue_invoices}`);
      }
      if (co.todo) signals.push(co.todo);
      if (co.feed_status === 'missing') {
        signals.push('IES feed missing');
      }
      for (const s of signals) upsertSubsidiarySignal(pack, co.company_name, s);
    }
  }

  if (controlPlane) {
    if (controlPlane.close_pct_complete != null) {
      pack.kpis.push({
        key: 'close_pct_control_plane',
        label: 'Close % complete (control plane)',
        value: controlPlane.close_pct_complete,
        status:
          controlPlane.feed_status === 'ok'
            ? 'live'
            : controlPlane.feed_status === 'partial'
              ? 'partial'
              : 'missing',
      });
    }
    if (controlPlane.burn_rate_monthly != null) {
      pack.kpis.push({
        key: 'burn_rate_monthly',
        label: 'Burn rate monthly',
        value: controlPlane.burn_rate_monthly,
        status:
          controlPlane.feed_status === 'ok' ? 'live' : 'partial',
      });
    }
    if (
      controlPlane.burn_rate_monthly != null &&
      controlPlane.cash_on_hand != null &&
      controlPlane.burn_rate_monthly > 0
    ) {
      const runway =
        Math.round(
          (controlPlane.cash_on_hand / controlPlane.burn_rate_monthly) * 10,
        ) / 10;
      pack.kpis.push({
        key: 'runway_mo',
        label: 'Implied runway months (cash/burn)',
        value: runway,
        status: 'partial',
      });
    } else if (!pack.kpis.some((k) => k.key === 'runway_mo')) {
      pack.kpis.push({
        key: 'runway_mo',
        label: 'Runway months',
        value: null,
        status: 'missing',
      });
    }
    for (const a of controlPlane.anomalies.slice(0, 8)) {
      pack.anomalies.push({
        kind: a.anomaly_kind,
        title: a.title,
        severity: a.severity,
        company: a.entity_id
          ? entityDisplayName({ entity_id: a.entity_id })
          : null,
      });
    }
    if (controlPlane.open_anomaly_count > 0) {
      pack.anomalies.push({
        kind: 'open_anomaly_count',
        count: controlPlane.open_anomaly_count,
        title: 'Open finance anomalies (control plane)',
      });
    }
    for (const s of controlPlane.subsidiaries) {
      upsertSubsidiarySignal(
        pack,
        s.name,
        s.has_data
          ? `feed=${s.feed_status}`
          : s.todo ?? `feed=${s.feed_status}`,
      );
    }
    const blockedClose = controlPlane.checklist.filter(
      (c) => c.status === 'blocked' || c.status === 'open',
    );
    if (blockedClose.length > 0) {
      pack.overdue_tasks.push({
        kind: 'close_checklist',
        open_or_blocked: blockedClose.length,
        samples: blockedClose.slice(0, 5).map((c) => ({
          label: c.item_label,
          status: c.status,
          period: c.period_key,
          company: c.entity_id
            ? entityDisplayName({ entity_id: c.entity_id })
            : null,
        })),
      });
    }
  } else {
    pack.data_gaps.push('Finance control plane report unavailable');
  }

  for (const m of portfolioBridge ?? []) {
    const signals: string[] = [];
    if (m.cash_k != null) signals.push(`dashboard_cash_k=${m.cash_k}`);
    if (m.runway_mo != null) signals.push(`dashboard_runway_mo=${m.runway_mo}`);
    if (m.net_burn_k != null) signals.push(`net_burn_k=${m.net_burn_k}`);
    for (const s of signals) {
      upsertSubsidiarySignal(pack, m.company_name, s);
    }
  }

  if (!iesCashLive && !pack.data_gaps.some((g) => /IES cash/i.test(g))) {
    pack.data_gaps.push(
      'IES cash/runway live feed not attached — advise from known SSC facts only',
    );
  }

  return capPack(pack);
}

export async function buildCtoContext(): Promise<CsuiteContextPack> {
  const pack = basePack('cto');
  const [tickets, glance] = await Promise.all([
    safeTickets('IT'),
    safeGlance(),
  ]);
  if (!tickets) pack.data_gaps.push('IT tickets unavailable');
  else pack.open_tickets = tickets;
  if (!glance) {
    pack.data_gaps.push('SSC IT checklist glance unavailable');
  } else {
    const it = glance.functions.find((f) => f.function_key === 'it');
    pack.kpis.push({
      key: 'it_completion',
      label: 'IT checklist completion %',
      value: it?.completion_pct ?? null,
      status: it ? 'live' : 'partial',
    });
    pack.overdue_tasks = [
      { function: 'it', overdue: it?.overdue_tasks ?? 0 },
    ];
  }
  pack.data_gaps.push(
    'Intune / license inventory detail omitted from compact pack — partial data',
  );
  return capPack(pack);
}

export async function buildCmoContext(): Promise<CsuiteContextPack> {
  const pack = basePack('cmo');
  const [tickets, glance] = await Promise.all([
    safeTickets('Marketing'),
    safeGlance(),
  ]);
  if (!tickets) pack.data_gaps.push('marketing tickets unavailable');
  else pack.open_tickets = tickets;
  if (!glance) {
    pack.data_gaps.push('SSC marketing checklist glance unavailable');
  } else {
    const m = glance.functions.find((f) => f.function_key === 'marketing');
    pack.kpis.push({
      key: 'marketing_completion',
      label: 'Marketing checklist completion %',
      value: m?.completion_pct ?? null,
      status: m ? 'live' : 'partial',
    });
  }
  pack.data_gaps.push(
    'Paid channel ROI / campaign ledger not included — do not invent ROI',
  );
  return capPack(pack);
}

export async function buildChroContext(): Promise<CsuiteContextPack> {
  const pack = basePack('chro');
  const [tickets, glance] = await Promise.all([
    safeTickets('HR'),
    safeGlance(),
  ]);
  if (!tickets) pack.data_gaps.push('HR tickets unavailable');
  else pack.open_tickets = tickets;
  if (!glance) {
    pack.data_gaps.push('SSC HR checklist glance unavailable');
  } else {
    const hr = glance.functions.find((f) => f.function_key === 'hr');
    pack.kpis.push({
      key: 'hr_completion',
      label: 'HR checklist completion %',
      value: hr?.completion_pct ?? null,
      status: hr ? 'live' : 'partial',
    });
    pack.overdue_tasks = [
      { function: 'hr', overdue: hr?.overdue_tasks ?? 0 },
    ];
  }
  pack.data_gaps.push(
    'HRIS headcount aggregate not in pack — never invent headcount',
  );
  return capPack(pack);
}

export async function buildCloContext(): Promise<CsuiteContextPack> {
  const pack = basePack('clo');
  const [tickets, glance] = await Promise.all([
    safeTickets('Legal'),
    safeGlance(),
  ]);
  if (!tickets) pack.data_gaps.push('legal tickets unavailable');
  else pack.open_tickets = tickets;
  if (!glance) {
    pack.data_gaps.push('SSC legal checklist glance unavailable');
  } else {
    const legal = glance.functions.find((f) => f.function_key === 'legal');
    pack.kpis.push({
      key: 'legal_completion',
      label: 'Legal checklist completion %',
      value: legal?.completion_pct ?? null,
      status: legal ? 'live' : 'partial',
    });
  }
  pack.data_gaps.push(
    'DocuSign envelope risk detail not in compact pack — do not invent send/void outcomes',
  );
  return capPack(pack);
}

export async function buildRoleContext(
  role: AiCsuiteRole,
  entityId?: string | null,
): Promise<CsuiteContextPack> {
  switch (role) {
    case 'cfo':
      return buildCfoContext(entityId);
    case 'cto':
      return buildCtoContext();
    case 'cmo':
      return buildCmoContext();
    case 'chro':
      return buildChroContext();
    case 'clo':
      return buildCloContext();
  }
}

export async function buildHqContext(): Promise<CsuiteContextPack> {
  const pack = basePack('hq');
  const roles = Object.keys(AI_CSUITE_ROLE_CONFIG) as AiCsuiteRole[];
  const packs = await Promise.all(roles.map((r) => buildRoleContext(r)));
  for (const p of packs) {
    pack.data_gaps.push(...p.data_gaps.map((g) => `${p.role}: ${g}`));
    pack.open_tickets.push(...p.open_tickets.slice(0, 2));
    pack.overdue_tasks.push(...p.overdue_tasks);
    for (const k of p.kpis) {
      pack.kpis.push({ ...k, key: `${p.role}.${k.key}` });
    }
  }
  pack.anomalies = packs.flatMap((p) =>
    p.anomalies.map((a) => ({ ...a, role: p.role })),
  );
  return capPack(pack);
}
