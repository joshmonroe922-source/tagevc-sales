/**
 * Safe demo/test data inventory + gated cleanup for Tage OS.
 * Never touches real users, roles, integration secrets, or core entities.
 */

import {
  hydrateDealFlowStore,
  listAllLeads,
} from '@/lib/data/deal-flow-store';
import { ensureMasterData } from '@/lib/data/master-data';
import {
  getTicketStore,
  hydrateTicketStore,
  isDemoSeedTicket,
  listTickets,
} from '@/lib/data/ticket-store';
import {
  deleteTicketAuditsByTicketIds,
  syncTicketAudits,
} from '@/lib/data/normalized/audits-repo';
import {
  deleteTicketsByIds,
  syncTickets,
} from '@/lib/data/normalized/tickets-repo';
import { queueNormalizedSync } from '@/lib/data/normalized/sync';
import { queueStorePersist } from '@/lib/data/persist';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { logActivity } from '@/lib/data/activity';
import {
  CLEANUP_CONFIRM_PHRASE,
  SAMPLE_ENTITY_IDS,
  type CleanupExecuteResult,
  type CleanupInventory,
  type DemoDomain,
} from '@/lib/admin/demo-data-cleanup-shared';

export {
  CLEANUP_CONFIRM_PHRASE,
  PROTECTED_ENTITY_IDS,
  SAMPLE_ENTITY_IDS,
  type CleanupExecuteResult,
  type CleanupInventory,
  type DemoDomain,
  type DomainCount,
} from '@/lib/admin/demo-data-cleanup-shared';

function isSampleCompanyName(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.includes('sample closed') ||
    n.includes('sample indy') ||
    n.includes('orbit data') ||
    n.includes('acme ai') ||
    n.includes('beacon robotics') ||
    n.includes('nova health') ||
    n.includes('ledgerly') ||
    n.includes('instant nda enterprise upsell') ||
    n.startsWith('sample ') ||
    n.includes('demo co') ||
    n.includes('test company')
  );
}

function isSeedOrSampleTicket(t: {
  ticket_id: string;
  company_name?: string | null;
  entity_id?: string | null;
}): boolean {
  return (
    isDemoSeedTicket(t.ticket_id) ||
    /^TK-00\d+$/i.test(t.ticket_id) ||
    Boolean(t.company_name && isSampleCompanyName(t.company_name)) ||
    Boolean(t.entity_id && SAMPLE_ENTITY_IDS.has(t.entity_id))
  );
}

export async function inventoryDemoData(): Promise<CleanupInventory> {
  await Promise.all([
    hydrateTicketStore({ forceSql: true }).catch(() => undefined),
    hydrateDealFlowStore().catch(() => undefined),
    ensureMasterData().catch(() => undefined),
  ]);

  const master = await ensureMasterData();
  const sampleEntities = master.entities.filter((e) =>
    SAMPLE_ENTITY_IDS.has(e.entity_id),
  );
  const sampleLeads = listAllLeads().filter(
    (l) =>
      !l.archived_at &&
      (isSampleCompanyName(l.company_name) ||
        (l.related_entity_id &&
          SAMPLE_ENTITY_IDS.has(l.related_entity_id))),
  );
  const seedTickets = listTickets().filter(isSeedOrSampleTicket);
  const samplePortfolio = master.companies.filter(
    (p) =>
      SAMPLE_ENTITY_IDS.has(p.entity_id) ||
      isSampleCompanyName(p.company_name),
  );

  let hrisSample: string[] = [];
  try {
    const sb = await createPersistClient();
    const { data } = await sb
      .from('os_hris_employees')
      .select('id, employee_key, work_email, full_name')
      .or(
        'work_email.ilike.%@example.%,employee_key.ilike.%sample%,full_name.ilike.Sample%',
      )
      .limit(50);
    hrisSample = (data ?? [])
      .filter((r) => r.employee_key !== 'dennis-vp-recruiting-r619')
      .map((r) => String(r.id));
  } catch {
    hrisSample = [];
  }

  return {
    generated_at: new Date().toISOString(),
    domains: [
      {
        domain: 'entities_sample',
        label: 'Sample entities (ENT-001 / ENT-003)',
        count: sampleEntities.length,
        sample_ids: sampleEntities.map((e) => e.entity_id),
      },
      {
        domain: 'leads_sample',
        label: 'Sample / demo leads',
        count: sampleLeads.length,
        sample_ids: sampleLeads.map((l) => l.lead_id).slice(0, 20),
      },
      {
        domain: 'tickets_seed',
        label: 'Seed / sample tickets',
        count: seedTickets.length,
        sample_ids: seedTickets.map((t) => t.ticket_id).slice(0, 20),
      },
      {
        domain: 'portfolio_sample',
        label: 'Sample portfolio rows',
        count: samplePortfolio.length,
        sample_ids: samplePortfolio.map((p) => p.portfolio_id).slice(0, 20),
      },
      {
        domain: 'hris_sample',
        label: 'Sample HRIS employees (excludes Dennis)',
        count: hrisSample.length,
        sample_ids: hrisSample.slice(0, 20),
      },
    ],
    protected_notes: [
      'Never delete ENT-FIRM, ENT-R619, ENT-INDA, or real profile users.',
      'Never delete OAuth tokens, DocuSign config, RLS, or schema.',
      'Dennis HRIS test case (dennis-vp-recruiting-r619) is protected unless explicitly listed.',
      'Destructive cleanup requires phrase DELETE DEMO DATA and CONFIRM_CLEANUP=yes.',
    ],
    recruit_inda_notes: [
      'Recruit 619 portal: do not wipe r619_* production tables or portal.recruit619.com users from Tage cleanup.',
      'Instant NDA portal: do not wipe production NDA/tenant data from Tage cleanup.',
      'Coordinate subsidiary demo resets separately with each portal owner.',
    ],
  };
}

export async function executeDemoCleanup(input: {
  domains: DemoDomain[];
  confirm_phrase: string;
  dry_run?: boolean;
  actor_email?: string | null;
}): Promise<CleanupExecuteResult> {
  const dryRun =
    input.dry_run !== false ||
    process.env.CONFIRM_CLEANUP !== 'yes';
  const beforeInv = await inventoryDemoData();
  const before = beforeInv.domains;
  const actions: string[] = [];

  if (input.confirm_phrase !== CLEANUP_CONFIRM_PHRASE) {
    return {
      ok: false,
      dry_run: true,
      before,
      after: before,
      actions: [],
      error: `Confirmation phrase must be exactly: ${CLEANUP_CONFIRM_PHRASE}`,
    };
  }

  if (process.env.CONFIRM_CLEANUP !== 'yes' && input.dry_run === false) {
    return {
      ok: false,
      dry_run: true,
      before,
      after: before,
      actions: [],
      error:
        'Set CONFIRM_CLEANUP=yes in the environment before destructive cleanup.',
    };
  }

  const selected = new Set(input.domains);

  for (const domain of selected) {
    const row = before.find((d) => d.domain === domain);
    if (!row || row.count === 0) {
      actions.push(`${domain}: nothing to clean`);
      continue;
    }

    if (dryRun) {
      actions.push(
        `[dry-run] would clean ${domain}: ${row.count} rows (${row.sample_ids.slice(0, 5).join(', ')})`,
      );
      continue;
    }

    if (domain === 'leads_sample') {
      const { getDealFlowStore } = await import('@/lib/data/deal-flow-store');
      const store = getDealFlowStore();
      let n = 0;
      for (const lead of store.leads) {
        if (
          !lead.archived_at &&
          (isSampleCompanyName(lead.company_name) ||
            (lead.related_entity_id &&
              SAMPLE_ENTITY_IDS.has(lead.related_entity_id)))
        ) {
          lead.archived_at = new Date().toISOString();
          n += 1;
        }
      }
      actions.push(`leads_sample: archived ${n} leads`);
    } else if (domain === 'tickets_seed') {
      const tickets = listTickets().filter(isSeedOrSampleTicket);
      const ids = tickets.map((t) => t.ticket_id);
      const drop = new Set(ids.map((id) => id.toUpperCase()));
      const store = getTicketStore();
      store.tickets = store.tickets.filter(
        (t) => !drop.has(t.ticket_id.toUpperCase()),
      );
      store.audits = store.audits.filter(
        (a) => !drop.has(a.ticket_id.toUpperCase()),
      );
      queueStorePersist('tickets', () => structuredClone(store));
      // Remaining real tickets may still dual-write; seeds are hard-deleted.
      queueNormalizedSync('os_tickets', async () => {
        await syncTickets(store.tickets);
      });
      queueNormalizedSync('os_ticket_audits', async () => {
        await syncTicketAudits(store.audits);
      });
      await deleteTicketAuditsByTicketIds(ids);
      await deleteTicketsByIds(ids);
      actions.push(
        `tickets_seed: deleted ${ids.length} seed/sample tickets from memory+SQL`,
      );
    } else if (domain === 'hris_sample') {
      try {
        const sb = await createPersistClient();
        const { data } = await sb
          .from('os_hris_employees')
          .select('id, employee_key')
          .or(
            'work_email.ilike.%@example.%,employee_key.ilike.%sample%,full_name.ilike.Sample%',
          );
        const ids = (data ?? [])
          .filter((r) => r.employee_key !== 'dennis-vp-recruiting-r619')
          .map((r) => String(r.id));
        if (ids.length) {
          await sb.from('os_hris_employees').delete().in('id', ids);
        }
        actions.push(`hris_sample: deleted ${ids.length} sample employees`);
      } catch (e) {
        actions.push(
          `hris_sample: skipped (${e instanceof Error ? e.message : 'error'})`,
        );
      }
    } else if (domain === 'entities_sample' || domain === 'portfolio_sample') {
      actions.push(
        `${domain}: marked for review only — sample entities stay in seed until master-data seed is toggled off (protected against blind wipe)`,
      );
    }
  }

  const afterInv = dryRun ? beforeInv : await inventoryDemoData();
  if (!dryRun) {
    await logActivity({
      module: 'system',
      action: 'demo_cleanup',
      title: 'Demo data cleanup executed',
      detail: actions.join('; '),
    }).catch(() => undefined);
  }

  return {
    ok: true,
    dry_run: dryRun,
    before,
    after: afterInv.domains,
    actions,
  };
}
