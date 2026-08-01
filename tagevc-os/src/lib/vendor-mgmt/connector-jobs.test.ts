import { describe, expect, it } from 'vitest';
import { VM_CONNECTOR_SCAFFOLDS } from '@/lib/vendor-mgmt/connectors';
import { runConnectorSyncJob } from '@/lib/vendor-mgmt/connector-jobs';

describe('vm connector jobs', () => {
  it('dry-runs with syncOk false when LIVE unset', async () => {
    const id = VM_CONNECTOR_SCAFFOLDS[0]!.id;
    const prev = process.env.VM_HRIS_LIVE;
    delete process.env.VM_HRIS_LIVE;
    const result = await runConnectorSyncJob({
      integrationId: id,
      actorEmail: 'ops@tagevc.com',
    });
    expect(result.ok).toBe(true);
    expect(result.syncOk).toBe(false);
    expect(result.status).toBe('dry_run');
    expect(result.dryRun).toBe(true);
    expect(result.message).toContain('Dry-run');
    if (prev === undefined) delete process.env.VM_HRIS_LIVE;
    else process.env.VM_HRIS_LIVE = prev;
  });

  it('rejects unknown ids', async () => {
    const result = await runConnectorSyncJob({ integrationId: 'INT-NOPE' });
    expect(result.ok).toBe(false);
    expect(result.syncOk).toBe(false);
    expect(result.status).toBe('failed');
  });
});
