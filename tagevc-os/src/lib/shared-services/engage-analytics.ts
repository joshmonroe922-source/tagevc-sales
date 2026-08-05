/**
 * Firm Engage analytics — Dialpad + ECC rollups by entity.
 * Fail-closed when LIVE flags/creds missing. Never invent metrics.
 */

import { createClient } from '@/lib/supabase/server';
import {
  CONSOLIDATED_SELECT_VALUE,
  ENTITY_SELECT_PRIORITY_IDS,
  entitySelectLabel,
} from '@/lib/entities/display-order';
import { getCachedEntitySelectOptions } from '@/lib/entities/entity-select-cache';
import { normalizeEntityId } from '@/lib/entities/display-name';

export type EngageEntityOption = { value: string; label: string };

export type EngageMetricChip = {
  label: string;
  value: string;
  source: 'dialpad' | 'ecc' | 'unavailable';
  hint?: string;
};

export type EngageAnalyticsBundle = {
  scopeLabel: string;
  entityId: string | null; // null = consolidated
  dialpadLive: boolean;
  eccLive: boolean;
  metrics: EngageMetricChip[];
  notes: string[];
  eccHref: string;
  dialpadHref: string;
};

function dialpadLive(): boolean {
  return (
    process.env.DIALPAD_LIVE === '1' &&
    Boolean(process.env.DIALPAD_API_KEY?.trim())
  );
}

function eccLive(): boolean {
  return (
    process.env.TAGE_ECC_LIVE === '1' ||
    process.env.ECC_LIVE === '1' ||
    process.env.CAMPAIGN_LIVE === '1'
  );
}

export function listEngageEntityFilterOptions(): EngageEntityOption[] {
  const fromCache = getCachedEntitySelectOptions().map((o) => ({
    value: o.value,
    label: o.label,
  }));
  const map = new Map<string, string>();
  map.set(CONSOLIDATED_SELECT_VALUE, 'Consolidated (all entities)');
  for (const id of ENTITY_SELECT_PRIORITY_IDS) {
    map.set(id, entitySelectLabel(id));
  }
  for (const o of fromCache) {
    if (!map.has(o.value)) map.set(o.value, o.label);
  }
  return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
}

export function resolveEngageEntityScope(
  raw: string | null | undefined,
  opts: { firmWide: boolean; profileEntityId: string | null },
): { entityId: string | null; scopeLabel: string } {
  if (!opts.firmWide) {
    const id = normalizeEntityId(opts.profileEntityId) || 'ENT-FIRM';
    return { entityId: id, scopeLabel: entitySelectLabel(id) };
  }
  const v = (raw ?? CONSOLIDATED_SELECT_VALUE).trim();
  if (!v || v === CONSOLIDATED_SELECT_VALUE) {
    return { entityId: null, scopeLabel: 'Consolidated (all entities)' };
  }
  const id = normalizeEntityId(v);
  return { entityId: id, scopeLabel: entitySelectLabel(id) };
}

async function eccCounts(entityId: string | null): Promise<{
  journeys: number | null;
  activeEnrollments: number | null;
  error?: string;
}> {
  if (!eccLive()) {
    return { journeys: null, activeEnrollments: null, error: 'ECC not LIVE' };
  }
  try {
    const supabase = await createClient();
    let journeyQ = supabase
      .from('ecc_journeys')
      .select('id', { count: 'exact', head: true });
    let enrollQ = supabase
      .from('ecc_journey_enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('state', 'active');
    if (entityId) {
      journeyQ = journeyQ.eq('entity_id', entityId);
      enrollQ = enrollQ.eq('entity_id', entityId);
    }
    const [j, e] = await Promise.all([journeyQ, enrollQ]);
    if (j.error || e.error) {
      const msg = j.error?.message || e.error?.message || 'ECC query failed';
      if (/does not exist|relation/i.test(msg)) {
        return {
          journeys: null,
          activeEnrollments: null,
          error: 'ECC tables not applied yet',
        };
      }
      return { journeys: null, activeEnrollments: null, error: msg };
    }
    return {
      journeys: j.count ?? 0,
      activeEnrollments: e.count ?? 0,
    };
  } catch (err) {
    return {
      journeys: null,
      activeEnrollments: null,
      error: err instanceof Error ? err.message : 'ECC unreachable',
    };
  }
}

/**
 * Dialpad firm rollups require admin Stats API rights and are async CSV.
 * Until a cached aggregation job exists, report connectivity honestly rather
 * than fabricating call/SMS totals.
 */
function dialpadChips(): EngageMetricChip[] {
  if (!dialpadLive()) {
    return [
      {
        label: 'Calls',
        value: '—',
        source: 'unavailable',
        hint: 'Set DIALPAD_LIVE=1 + DIALPAD_API_KEY',
      },
      {
        label: 'SMS',
        value: '—',
        source: 'unavailable',
        hint: 'Dialpad not LIVE',
      },
    ];
  }
  return [
    {
      label: 'Calls',
      value: 'See Dialpad',
      source: 'dialpad',
      hint: 'Firm Stats API export is async — open Dialpad analytics or entity portal Engage → Dialpad for user metrics',
    },
    {
      label: 'SMS',
      value: 'See Dialpad',
      source: 'dialpad',
      hint: 'Same as calls — live aggregates per user on subsidiary Dialpad pages',
    },
  ];
}

export async function loadEngageAnalytics(input: {
  entityId: string | null;
  scopeLabel: string;
}): Promise<EngageAnalyticsBundle> {
  const notes: string[] = [];
  const dpLive = dialpadLive();
  const eccOn = eccLive();

  if (!dpLive) {
    notes.push(
      'Dialpad metrics stay empty until DIALPAD_LIVE=1 and DIALPAD_API_KEY are set.',
    );
  }
  if (!eccOn) {
    notes.push(
      'Email campaign counts stay empty until TAGE_ECC_LIVE=1 (or ECC_LIVE=1) and ECC tables are applied.',
    );
  }

  const ecc = await eccCounts(input.entityId);
  if (ecc.error) notes.push(`ECC: ${ecc.error}`);

  const metrics: EngageMetricChip[] = [
    ...dialpadChips(),
    {
      label: 'Campaign journeys',
      value: ecc.journeys == null ? '—' : String(ecc.journeys),
      source: ecc.journeys == null ? 'unavailable' : 'ecc',
      hint:
        ecc.journeys == null
          ? 'Connect ECC'
          : input.entityId
            ? 'Journeys for this entity'
            : 'Journeys across all entities',
    },
    {
      label: 'Active enrollments',
      value: ecc.activeEnrollments == null ? '—' : String(ecc.activeEnrollments),
      source: ecc.activeEnrollments == null ? 'unavailable' : 'ecc',
      hint:
        ecc.activeEnrollments == null
          ? 'Connect ECC'
          : 'People currently in a journey',
    },
    {
      label: 'Opens / clicks',
      value: eccOn ? 'Open ECC' : '—',
      source: eccOn ? 'ecc' : 'unavailable',
      hint: eccOn
        ? 'Detailed send/open/click funnels live in Email Campaign Center analytics'
        : 'ECC not LIVE',
    },
  ];

  return {
    scopeLabel: input.scopeLabel,
    entityId: input.entityId,
    dialpadLive: dpLive,
    eccLive: eccOn,
    metrics,
    notes,
    eccHref: '/shared-services/marketing/email-campaign-center/analytics',
    dialpadHref: 'https://dialpad.com/app',
  };
}
