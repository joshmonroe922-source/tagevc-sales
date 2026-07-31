/**
 * AI Business Intelligence shell — aggregates partner + marketing presence signals.
 */

import { PARTNER_CATALOG } from '@/lib/partners/catalog';
import { buildPartnerHubCards, resolvePartnerStatus } from '@/lib/partners/registry';
import {
  listBiSignals,
  listCommissionStubs,
  listMarketingPresence,
  listPartnerBindings,
} from '@/lib/partners/repo';

export type PartnerBiReport = {
  generatedAt: string;
  partnerCount: number;
  configuredCount: number;
  liveCount: number;
  scaffoldedCount: number;
  presence: Array<{
    entity_id: string;
    kind: string;
    label: string;
    status: string;
    last_import_at: string | null;
  }>;
  signals: Array<{
    partner_key: string;
    metric_label: string;
    value_num: number | null;
    value_text: string | null;
    observed_at: string;
    entity_id: string | null;
  }>;
  commissionQueue: Array<{
    id: string;
    entity_id: string;
    commission_cents: number;
    status: string;
  }>;
  insightBullets: string[];
  cards: ReturnType<typeof buildPartnerHubCards>;
};

export async function buildPartnerBiReport(opts?: {
  entityId?: string | null;
}): Promise<PartnerBiReport> {
  const [bindings, presence, signals, commissions] = await Promise.all([
    listPartnerBindings(opts?.entityId),
    listMarketingPresence(opts?.entityId),
    listBiSignals({ limit: 50, entityId: opts?.entityId }),
    listCommissionStubs(opts?.entityId),
  ]);

  const bindingStatus = Object.fromEntries(
    bindings.map((b) => [b.partner_key, b.status]),
  ) as Parameters<typeof buildPartnerHubCards>[0] extends infer O
    ? O extends { bindings?: infer B }
      ? B
      : never
    : never;

  const cards = buildPartnerHubCards({ bindings: bindingStatus ?? undefined });
  let configuredCount = 0;
  let liveCount = 0;
  let scaffoldedCount = 0;
  for (const def of PARTNER_CATALOG) {
    const st = resolvePartnerStatus(def, bindings.find((b) => b.partner_key === def.key)?.status);
    if (st === 'live') liveCount += 1;
    else if (st === 'configured') configuredCount += 1;
    else scaffoldedCount += 1;
  }

  const insightBullets: string[] = [];
  insightBullets.push(
    `${PARTNER_CATALOG.length} partners on the OS spine; ${liveCount} live, ${configuredCount} configured (env ready), ${scaffoldedCount} scaffolded.`,
  );
  const presenceReady = presence.filter((p) =>
    ['configured', 'live'].includes(p.status),
  ).length;
  insightBullets.push(
    `Marketing presence: ${presence.length} property slots (${presenceReady} connected) across Google Business, GA4, LinkedIn Company Pages.`,
  );
  const pendingComm = commissions.filter((c) =>
    ['calculated', 'pending_push'].includes(c.status),
  );
  if (pendingComm.length) {
    insightBullets.push(
      `${pendingComm.length} Gusto commission stub(s) waiting for payroll push (GUSTO_LIVE).`,
    );
  } else {
    insightBullets.push(
      'No pending Gusto commission pushes — paid-invoice → payroll seam is idle.',
    );
  }
  if (signals.length === 0) {
    insightBullets.push(
      'No partner BI signals imported yet — connect partner APIs / run imports to feed insights.',
    );
  } else {
    insightBullets.push(
      `${signals.length} recent partner BI signal(s) available for AI C-Suite context.`,
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    partnerCount: PARTNER_CATALOG.length,
    configuredCount,
    liveCount,
    scaffoldedCount,
    presence: presence.map((p) => ({
      entity_id: p.entity_id,
      kind: p.kind,
      label: p.label,
      status: p.status,
      last_import_at: p.last_import_at,
    })),
    signals: signals.map((s) => ({
      partner_key: s.partner_key,
      metric_label: s.metric_label,
      value_num: s.value_num,
      value_text: s.value_text,
      observed_at: s.observed_at,
      entity_id: s.entity_id,
    })),
    commissionQueue: commissions.slice(0, 20).map((c) => ({
      id: c.id,
      entity_id: c.entity_id,
      commission_cents: c.commission_cents,
      status: c.status,
    })),
    insightBullets,
    cards,
  };
}
