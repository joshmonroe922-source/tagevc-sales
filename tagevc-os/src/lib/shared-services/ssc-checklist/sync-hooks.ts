/**
 * Subsidiary data sync hooks into Tage for SSC completion.
 * No SSC UI in subsidiary portals — Tage is system of action.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { companyName } from './scope';
import type { SscSyncSnapshot } from './types';

type SyncPayload = {
  highlights: string[];
  metrics?: Record<string, number | string | null>;
};

async function safeCount(
  table: string,
  filter?: { column: string; value: string },
): Promise<number | null> {
  try {
    const supabase = await createPersistClient();
    let q = supabase.from(table).select('*', { count: 'exact', head: true });
    if (filter) q = q.eq(filter.column, filter.value);
    const { count, error } = await q;
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

export async function collectSubsidiarySyncHooks(opts?: {
  entityIds?: string[];
}): Promise<SscSyncSnapshot[]> {
  const targets = opts?.entityIds?.length
    ? opts.entityIds
    : ['ENT-R619', 'ENT-INDA', 'ENT-FIRM'];
  const now = new Date().toISOString();
  const out: SscSyncSnapshot[] = [];

  for (const entityId of targets) {
    const packs: Array<{
      source_key: string;
      run: () => Promise<{ status: SscSyncSnapshot['status']; payload: SyncPayload }>;
    }> = [
      {
        source_key: 'ticket_demand',
        run: async () => {
          const open = await safeCount('os_tickets', {
            column: 'entity_id',
            value: entityId,
          });
          if (open === null) {
            return {
              status: 'missing',
              payload: { highlights: ['Ticket table unavailable'] },
            };
          }
          return {
            status: 'ok',
            payload: {
              highlights: [`${open} ticket row(s) scoped to company`],
              metrics: { ticket_rows: open },
            },
          };
        },
      },
      {
        source_key: 'hr_roster_signal',
        run: async () => {
          const n = await safeCount('profiles', {
            column: 'entity_id',
            value: entityId,
          });
          if (n === null) {
            return {
              status: 'partial',
              payload: { highlights: ['Roster signal unavailable'] },
            };
          }
          return {
            status: 'ok',
            payload: {
              highlights: [`${n} active profile row(s)`],
              metrics: { roster_profiles: n },
            },
          };
        },
      },
    ];

    if (entityId === 'ENT-R619') {
      packs.push({
        source_key: 'recruit_ops_rollup',
        run: async () => {
          const n = await safeCount('os_subsidiary_rollup_phase53_snapshots');
          if (n === null) {
            return {
              status: 'partial',
              payload: {
                highlights: [
                  'Recruit rollup table not connected — use portfolio bridge',
                ],
              },
            };
          }
          return {
            status: n > 0 ? 'ok' : 'partial',
            payload: {
              highlights: [
                n > 0
                  ? `${n} Recruit rollup snapshot(s) available`
                  : 'No Recruit rollup snapshots yet',
              ],
              metrics: { rollup_snapshots: n },
            },
          };
        },
      });
      packs.push({
        source_key: 'recruit_marketing',
        run: async () => {
          const n = await safeCount('os_marketing_campaigns', {
            column: 'entity_id',
            value: 'ENT-R619',
          });
          if (n === null) {
            return {
              status: 'partial',
              payload: { highlights: ['Marketing campaigns unavailable'] },
            };
          }
          return {
            status: 'ok',
            payload: {
              highlights: [`${n} Recruit marketing campaign row(s)`],
              metrics: { campaigns: n },
            },
          };
        },
      });
    }

    if (entityId === 'ENT-INDA') {
      packs.push({
        source_key: 'inda_saas_kpi',
        run: async () => {
          const n = await safeCount('inda_saas_kpi_snapshots', {
            column: 'entity_id',
            value: 'ENT-INDA',
          });
          if (n === null) {
            return {
              status: 'partial',
              payload: {
                highlights: ['Instant NDA SaaS KPI snapshots not connected'],
              },
            };
          }
          return {
            status: n > 0 ? 'ok' : 'partial',
            payload: {
              highlights: [
                n > 0
                  ? `${n} Instant NDA SaaS KPI snapshot(s)`
                  : 'No Instant NDA SaaS snapshots yet — live spine may still be available',
              ],
              metrics: { saas_snapshots: n },
            },
          };
        },
      });
      packs.push({
        source_key: 'inda_kpi_goals',
        run: async () => {
          const n = await safeCount('inda_kpi_goals', {
            column: 'entity_id',
            value: 'ENT-INDA',
          });
          if (n === null) {
            return {
              status: 'partial',
              payload: { highlights: ['INDA KPI goals table unavailable'] },
            };
          }
          return {
            status: n > 0 ? 'ok' : 'partial',
            payload: {
              highlights: [`${n} Instant NDA KPI goal row(s)`],
              metrics: { kpi_goals: n },
            },
          };
        },
      });
    }

    // Cross-company finance / legal / marketing depth for parent + each sub
    packs.push({
      source_key: 'finance_bridge',
      run: async () => {
        const anomalies = await safeCount('os_finance_anomaly_phase55_alerts', {
          column: 'entity_id',
          value: entityId,
        });
        const close = await safeCount('os_finance_close_checklist_phase55_events');
        if (anomalies === null && close === null) {
          return {
            status: 'partial',
            payload: { highlights: ['Finance evidence tables unavailable'] },
          };
        }
        return {
          status: 'ok',
          payload: {
            highlights: [
              anomalies != null
                ? `${anomalies} finance anomaly alert(s)`
                : 'Anomaly table missing',
              close != null
                ? `${close} close checklist event(s) firm-wide`
                : 'Close events missing',
            ],
            metrics: { anomalies, close_events: close },
          },
        };
      },
    });

    packs.push({
      source_key: 'legal_docusign',
      run: async () => {
        const n = await safeCount('os_docusign_envelopes');
        if (n === null) {
          return {
            status: 'partial',
            payload: { highlights: ['DocuSign envelopes unavailable'] },
          };
        }
        return {
          status: 'ok',
          payload: {
            highlights: [`${n} DocuSign envelope row(s) (firm view)`],
            metrics: { envelopes: n },
          },
        };
      },
    });

    packs.push({
      source_key: 'it_assets',
      run: async () => {
        const n = await safeCount('os_it_hardware_assets', {
          column: 'entity_id',
          value: entityId,
        });
        if (n === null) {
          return {
            status: 'partial',
            payload: { highlights: ['IT assets unavailable'] },
          };
        }
        return {
          status: 'ok',
          payload: {
            highlights: [`${n} hardware asset row(s)`],
            metrics: { hardware_assets: n },
          },
        };
      },
    });

    for (const pack of packs) {
      try {
        const result = await pack.run();
        out.push({
          entity_id: entityId,
          company_name: companyName(entityId),
          source_key: pack.source_key,
          status: result.status,
          captured_at: now,
          highlights: result.payload.highlights,
        });
        // Best-effort persist
        try {
          const supabase = await createPersistClient();
          await supabase.from('os_ssc_sync_snapshots').insert({
            entity_id: entityId,
            source_key: pack.source_key,
            captured_at: now,
            payload: result.payload,
            status: result.status,
          });
        } catch {
          // fail-soft
        }
      } catch {
        out.push({
          entity_id: entityId,
          company_name: companyName(entityId),
          source_key: pack.source_key,
          status: 'error',
          captured_at: now,
          highlights: ['Sync hook failed'],
        });
      }
    }
  }

  return out;
}
