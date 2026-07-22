import { randomUUID } from 'crypto';
import {
  runArchiveGovernanceWorker,
  type ArchiveGovernanceResult,
} from '@/lib/docusign/archive-governance';
import { createPersistClient } from '@/lib/supabase/persist-client';

export type ArchiveCampaignKind =
  | 'legacy_backfill_completion'
  | 'quarterly_full_integrity';

export type ArchiveCampaignResult = {
  ok: boolean;
  disposition:
    | 'not_due'
    | 'gated'
    | 'busy'
    | 'already_complete'
    | 'claimed'
    | 'failed';
  campaignId?: string;
  status?: string;
  progressPct?: number;
  gateReason?: string | null;
  remainingUnhashed?: number;
  quarantineBacklog?: number;
  governance?: ArchiveGovernanceResult;
  error?: string;
};

type Claim = {
  disposition:
    | 'not_due'
    | 'gated'
    | 'busy'
    | 'already_complete'
    | 'claimed'
    | 'already_open'
    | 'opened';
  campaign_id?: string;
  status?: string;
  progress_pct?: number;
  gate_reason?: string | null;
  gate_remaining_unhashed?: number;
  gate_quarantine_backlog?: number;
  lease_token?: string;
  fence_version?: number;
  run_kind?: 'legacy_backfill' | 'integrity_scan';
  scan_mode?: 'sample' | 'full';
  retry_at?: string;
  quarterly_full_due?: boolean;
};

function mapCampaignParam(
  value: string | null | undefined,
): ArchiveCampaignKind | null {
  if (value === 'quarterly' || value === 'quarterly_full_integrity') {
    return 'quarterly_full_integrity';
  }
  if (value === 'backfill' || value === 'legacy_backfill_completion') {
    return 'legacy_backfill_completion';
  }
  return null;
}

export { mapCampaignParam };

export async function runArchiveCampaignTick(input: {
  campaignKind: ArchiveCampaignKind;
  trigger: 'cron' | 'manual';
  requestedBy?: string | null;
  workerId?: string;
  force?: boolean;
  limit?: number;
}): Promise<ArchiveCampaignResult> {
  const sb = await createPersistClient();
  const workerId =
    input.workerId?.trim().slice(0, 100) || `archive-campaign-${randomUUID()}`;
  const { data, error } = await sb.rpc('claim_docusign_archive_campaign_work', {
    p_campaign_kind: input.campaignKind,
    p_trigger_source: input.trigger,
    p_requested_by: input.requestedBy ?? null,
    p_worker_id: workerId,
    p_lease_seconds: 300,
    p_force: input.force ?? false,
  });
  const claim = data as Claim | null;
  if (error) {
    return {
      ok: false,
      disposition: 'failed',
      error: error.message,
    };
  }
  if (!claim?.disposition) {
    return {
      ok: false,
      disposition: 'failed',
      error: 'Archive campaign claim returned empty disposition',
    };
  }
  if (claim.disposition === 'not_due') {
    return {
      ok: true,
      disposition: 'not_due',
      status: 'not_due',
      progressPct: claim.progress_pct,
    };
  }
  if (claim.disposition === 'gated') {
    return {
      ok: true,
      disposition: 'gated',
      campaignId: claim.campaign_id,
      status: claim.status,
      progressPct: claim.progress_pct,
      gateReason: claim.gate_reason,
      remainingUnhashed: claim.gate_remaining_unhashed,
      quarantineBacklog: claim.gate_quarantine_backlog,
    };
  }
  if (claim.disposition === 'busy') {
    return {
      ok: false,
      disposition: 'busy',
      campaignId: claim.campaign_id,
      status: claim.status,
      error: `Archive campaign busy until ${claim.retry_at ?? 'lease expiry'}`,
    };
  }
  if (claim.disposition === 'already_complete') {
    return {
      ok: true,
      disposition: 'already_complete',
      campaignId: claim.campaign_id,
      status: 'completed',
      progressPct: claim.progress_pct ?? 100,
      remainingUnhashed: claim.gate_remaining_unhashed,
      quarantineBacklog: claim.gate_quarantine_backlog,
    };
  }
  if (
    claim.disposition !== 'claimed' ||
    !claim.campaign_id ||
    !claim.lease_token ||
    claim.fence_version == null ||
    !claim.run_kind ||
    !claim.scan_mode
  ) {
    return {
      ok: false,
      disposition: 'failed',
      campaignId: claim.campaign_id,
      error: `Unexpected campaign disposition ${claim.disposition}`,
    };
  }

  const governance = await runArchiveGovernanceWorker({
    runKind: claim.run_kind,
    scanMode: claim.scan_mode,
    trigger: input.trigger,
    requestedBy: input.requestedBy,
    workerId,
    limit: input.limit,
  });

  if (!governance.run_id) {
    await sb.rpc('fail_docusign_archive_campaign', {
      p_campaign_id: claim.campaign_id,
      p_lease_token: claim.lease_token,
      p_fence_version: claim.fence_version,
      p_error_code: 'governance_claim_failed',
      p_retryable: true,
    });
    return {
      ok: false,
      disposition: 'failed',
      campaignId: claim.campaign_id,
      governance,
      error: governance.error || 'Governance run did not claim work',
    };
  }

  const { data: finish, error: finishError } = await sb.rpc(
    'finish_docusign_archive_campaign',
    {
      p_campaign_id: claim.campaign_id,
      p_lease_token: claim.lease_token,
      p_fence_version: claim.fence_version,
      p_governance_run_id: governance.run_id,
      p_has_more: governance.checkpointed,
    },
  );
  if (finishError) {
    await sb.rpc('fail_docusign_archive_campaign', {
      p_campaign_id: claim.campaign_id,
      p_lease_token: claim.lease_token,
      p_fence_version: claim.fence_version,
      p_error_code: 'campaign_finish_failed',
      p_retryable: true,
    });
    return {
      ok: false,
      disposition: 'failed',
      campaignId: claim.campaign_id,
      governance,
      error: finishError.message,
    };
  }
  const finished = finish as {
    status?: string;
    progress_pct?: number;
    gate_remaining_unhashed?: number;
    gate_quarantine_backlog?: number;
  } | null;
  return {
    ok: governance.ok || governance.claimed > 0,
    disposition: 'claimed',
    campaignId: claim.campaign_id,
    status: finished?.status,
    progressPct: finished?.progress_pct,
    remainingUnhashed: finished?.gate_remaining_unhashed,
    quarantineBacklog: finished?.gate_quarantine_backlog,
    governance,
  };
}

export async function listArchiveCampaigns(input: {
  firmWide: boolean;
}) {
  if (!input.firmWide) {
    return {
      campaigns: [] as Array<Record<string, unknown>>,
      live: {
        remaining_unhashed: 0,
        quarantine_backlog: 0,
        quarantine_oldest_days: 0,
        quarterly_full_due: false,
      },
      lastFullScanAt: null as string | null,
      error: undefined as string | undefined,
    };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('list_docusign_archive_campaign_hub', {
    p_limit: 8,
  });
  const hub = data as {
    campaigns?: Array<Record<string, unknown>>;
    live?: {
      remaining_unhashed?: number;
      quarantine_backlog?: number;
      quarantine_oldest_days?: number;
      quarterly_full_due?: boolean;
    };
    last_full_scan_at?: string | null;
  } | null;
  return {
    campaigns: hub?.campaigns ?? [],
    live: {
      remaining_unhashed: hub?.live?.remaining_unhashed ?? 0,
      quarantine_backlog: hub?.live?.quarantine_backlog ?? 0,
      quarantine_oldest_days: hub?.live?.quarantine_oldest_days ?? 0,
      quarterly_full_due: hub?.live?.quarterly_full_due ?? false,
    },
    lastFullScanAt: hub?.last_full_scan_at ?? null,
    error: error?.message,
  };
}
