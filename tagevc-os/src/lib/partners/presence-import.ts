/**
 * Marketing presence import — fail-closed dry-run until LIVE.
 * Writes BI signal rows so Partner BI stays warm.
 */

import { marketingPresenceImportStub } from '@/lib/partners/adapters';
import type { PartnerKey } from '@/lib/partners/catalog';
import { createPersistClient } from '@/lib/supabase/persist-client';

export type PresenceImportResult = {
  kind: string;
  entityId: string;
  dryRun: boolean;
  ok: boolean;
  message: string;
};

const KINDS = [
  'google_business',
  'google_analytics',
  'linkedin_company',
] as const;

export async function runMarketingPresenceImport(input: {
  kind: (typeof KINDS)[number];
  entityId: string;
}): Promise<PresenceImportResult> {
  const adapter = await marketingPresenceImportStub(input.kind, {
    entityId: input.entityId,
  });
  const dryRun = adapter.ok ? Boolean(adapter.dryRun) : true;
  const message = adapter.ok ? adapter.message : adapter.error;

  try {
    const sb = await createPersistClient();
    await sb.from('os_partner_bi_signals').insert({
      partner_key: input.kind as PartnerKey,
      entity_id: input.entityId,
      metric_key: 'presence_import',
      metric_label: `${input.kind} import`,
      value_num: dryRun ? 0 : 1,
      value_text: message.slice(0, 240),
      observed_at: new Date().toISOString(),
      meta: {
        dry_run: dryRun,
        status: adapter.ok ? (adapter.dryRun ? 'dry_run' : 'live_ok') : 'failed',
        source: dryRun ? 'dry_run' : 'live',
      },
    });
    await sb
      .from('os_marketing_presence_properties')
      .update({
        last_import_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('entity_id', input.entityId)
      .eq('kind', input.kind);
  } catch {
    /* fail-soft when SQL not applied */
  }

  return {
    kind: input.kind,
    entityId: input.entityId,
    dryRun,
    ok: adapter.ok,
    message,
  };
}

export async function runAllPresenceImportsForEntity(
  entityId: string,
): Promise<PresenceImportResult[]> {
  const out: PresenceImportResult[] = [];
  for (const kind of KINDS) {
    out.push(await runMarketingPresenceImport({ kind, entityId }));
  }
  return out;
}
