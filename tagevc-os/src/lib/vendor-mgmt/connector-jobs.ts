/**
 * Fail-closed connector sync jobs for Vendor Management integrations.
 * LIVE=0 → dry-run audit only. Dry-run is never sync_ok.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  VM_CONNECTOR_SCAFFOLDS,
  connectorEnvReady,
  type ConnectorScaffold,
} from '@/lib/vendor-mgmt/connectors';
import { appendAuditEvent } from '@/lib/vendor-mgmt/repo';

export type ConnectorJobStatus = 'dry_run' | 'live_ok' | 'blocked' | 'failed';

export type ConnectorJobResult = {
  integrationId: string;
  systemName: string;
  /** Request accepted / stub executed without throw. */
  ok: boolean;
  /** True only when a live remote sync succeeded. */
  syncOk: boolean;
  status: ConnectorJobStatus;
  dryRun: boolean;
  message: string;
  missingEnv: string[];
};

function scaffoldById(id: string): ConnectorScaffold | undefined {
  return VM_CONNECTOR_SCAFFOLDS.find((c) => c.id === id);
}

export async function runConnectorSyncJob(input: {
  integrationId: string;
  actorEmail?: string | null;
}): Promise<ConnectorJobResult> {
  const scaffold = scaffoldById(input.integrationId);
  if (!scaffold) {
    return {
      integrationId: input.integrationId,
      systemName: input.integrationId,
      ok: false,
      syncOk: false,
      status: 'failed',
      dryRun: true,
      message: 'Unknown connector scaffold id',
      missingEnv: [],
    };
  }

  const { live, missing } = connectorEnvReady(scaffold);
  const now = new Date().toISOString();

  if (!live) {
    const message = `Dry-run sync for ${scaffold.system_name} — set ${scaffold.env_keys.find((k) => k.endsWith('_LIVE')) ?? 'LIVE'}=1 when ready. Missing: ${missing.join(', ') || 'none'}. Not counted as healthy sync.`;
    await touchIntegration(scaffold.id, {
      status: 'Planned',
      notes: `${scaffold.notes ?? ''} · last_dry_run_at=${now} · sync_ok=false`,
    });
    await appendAuditEvent({
      actor_email: input.actorEmail ?? null,
      action: 'integration.sync_dry_run',
      object_type: 'integration',
      object_id: scaffold.id,
      new_value: message.slice(0, 400),
    });
    return {
      integrationId: scaffold.id,
      systemName: scaffold.system_name,
      ok: true,
      syncOk: false,
      status: 'dry_run',
      dryRun: true,
      message,
      missingEnv: missing,
    };
  }

  const message = `${scaffold.system_name} LIVE flag set but remote adapter not implemented — fail-closed.`;
  await touchIntegration(scaffold.id, {
    status: 'Error',
    notes: `${scaffold.notes ?? ''} · last_live_attempt_at=${now} · adapter_missing · sync_ok=false`,
  });
  await appendAuditEvent({
    actor_email: input.actorEmail ?? null,
    action: 'integration.sync_blocked',
    object_type: 'integration',
    object_id: scaffold.id,
    new_value: message,
  });
  return {
    integrationId: scaffold.id,
    systemName: scaffold.system_name,
    ok: false,
    syncOk: false,
    status: 'blocked',
    dryRun: false,
    message,
    missingEnv: missing,
  };
}

export async function runAllConnectorDryRuns(input: {
  actorEmail?: string | null;
}): Promise<ConnectorJobResult[]> {
  const out: ConnectorJobResult[] = [];
  for (const c of VM_CONNECTOR_SCAFFOLDS) {
    out.push(
      await runConnectorSyncJob({
        integrationId: c.id,
        actorEmail: input.actorEmail,
      }),
    );
  }
  return out;
}

async function touchIntegration(
  id: string,
  patch: { status?: string; notes?: string },
): Promise<void> {
  try {
    const sb = await createPersistClient();
    await sb
      .from('vm_integrations')
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
  } catch {
    /* fail-soft when row missing — seed scaffolds first */
  }
}
