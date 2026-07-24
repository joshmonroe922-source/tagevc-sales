/**
 * Auto-suggest / attach evidence snippets from known Tage systems.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import type { SscFunction } from './types';

export type EvidenceHint = {
  source: string;
  note: string;
  href?: string;
};

async function countEq(
  table: string,
  column: string,
  value: string,
): Promise<number | null> {
  try {
    const sb = await createPersistClient();
    const { count, error } = await sb
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(column, value);
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

async function countAll(table: string): Promise<number | null> {
  try {
    const sb = await createPersistClient();
    const { count, error } = await sb
      .from(table)
      .select('*', { count: 'exact', head: true });
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

export async function collectEvidenceHints(input: {
  function_key: SscFunction;
  entity_id: string | null;
}): Promise<EvidenceHint[]> {
  const entityId = input.entity_id ?? 'ENT-FIRM';
  const hints: EvidenceHint[] = [];

  try {
    if (input.function_key === 'finance') {
      const anomalies = await countEq(
        'os_finance_anomaly_phase55_alerts',
        'entity_id',
        entityId,
      );
      if (anomalies != null) {
        hints.push({
          source: 'finance_anomalies',
          note: `${anomalies} finance anomaly alert row(s) for company`,
          href: '/shared-services/finance',
        });
      }
      const closeEvents = await countAll(
        'os_finance_close_checklist_phase55_events',
      );
      if (closeEvents != null) {
        hints.push({
          source: 'finance_close_events',
          note: `${closeEvents} close checklist event(s) recorded firm-wide`,
          href: '/shared-services/finance',
        });
      }
    }

    if (input.function_key === 'hr' || input.function_key === 'it') {
      const profiles = await countEq('profiles', 'entity_id', entityId);
      if (profiles != null) {
        hints.push({
          source: 'roster',
          note: `${profiles} profile/roster row(s)`,
          href: '/shared-services/hr',
        });
      }
      const hardware = await countEq(
        'os_it_hardware_assets',
        'entity_id',
        entityId,
      );
      if (hardware != null) {
        hints.push({
          source: 'it_assets',
          note: `${hardware} hardware asset row(s)`,
          href: '/shared-services/it/assets',
        });
      }
    }

    if (input.function_key === 'marketing') {
      const campaigns = await countEq(
        'os_marketing_campaigns',
        'entity_id',
        entityId,
      );
      if (campaigns != null) {
        hints.push({
          source: 'campaigns',
          note: `${campaigns} campaign row(s)`,
          href: '/shared-services/marketing',
        });
      }
    }

    if (input.function_key === 'legal') {
      const envelopes = await countAll('os_docusign_envelopes');
      if (envelopes != null) {
        hints.push({
          source: 'docusign',
          note: `${envelopes} DocuSign envelope row(s) (firm view)`,
          href: '/shared-services/legal/docusign',
        });
      }
    }

    const tickets = await countEq('os_tickets', 'entity_id', entityId);
    if (tickets != null) {
      hints.push({
        source: 'tickets',
        note: `${tickets} ticket row(s) for company`,
        href: '/shared-services',
      });
    }
  } catch {
    // fail-soft
  }

  return hints;
}

export function formatEvidenceNote(hints: EvidenceHint[]): string {
  if (!hints.length) return '';
  return [
    'Auto-evidence (draft — confirm before closing):',
    ...hints.map((h) => `• [${h.source}] ${h.note}${h.href ? ` → ${h.href}` : ''}`),
  ].join('\n');
}
