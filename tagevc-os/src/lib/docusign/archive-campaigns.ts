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
  opsMilestone?: ArchiveCampaignOpsMilestoneResult | null;
  governance?: ArchiveGovernanceResult;
  error?: string;
};

export type ArchiveCampaignOpsEventKind =
  | 'backfill_completed'
  | 'backfill_gate_cleared'
  | 'quarterly_first_milestone'
  | 'quarterly_completed'
  | 'campaign_gated'
  | 'quarantine_aging_breach'
  | 'quarantine_aged_cleared';

export type ArchiveCampaignOpsMilestoneResult = {
  disposition: 'recorded' | 'already_recorded' | 'skipped' | 'failed';
  eventKind?: ArchiveCampaignOpsEventKind;
  eventId?: string;
  evidenceSha256?: string;
  firstQuarterlyMilestone?: boolean;
  error?: string;
};

export type ArchiveCampaignOpsReadiness = {
  backfill_complete: boolean;
  quarterly_unlocked: boolean;
  ops_ready: boolean;
  quarantine_aging_breach: boolean;
  quarantine_backlog_high: boolean;
  remaining_unhashed: number;
  quarantine_backlog: number;
  quarantine_oldest_days: number;
  quarterly_full_due: boolean;
  aging_sla_days: number;
  quarantine_backlog_gate: number;
  first_quarterly_milestone_at: string | null;
  last_ops_event_at: string | null;
  last_full_scan_at: string | null;
};

export type ArchiveQuarantineAgingRow = {
  quarantine_id: string;
  manifest_id?: string;
  envelope_id: string;
  document_id?: string;
  entity_id: string | null;
  file_kind: string;
  status: string;
  reason_code: string;
  expected_sha256?: string;
  observed_sha256?: string | null;
  row_version: number;
  opened_at: string;
  age_days: number;
  age_bucket: '0_7' | '8_30' | '31_45' | 'over_45' | string;
};

export type FirstQuarterlyRunbookStepKind =
  | 'gates_evaluated'
  | 'unlock_recorded'
  | 'runbook_ack'
  | 'first_quarterly_started'
  | 'first_quarterly_completed';

export type FirstQuarterlyGates = {
  contract_version: 'phase43-v1' | string;
  remaining_unhashed: number;
  quarantine_backlog: number;
  quarantine_oldest_days: number;
  aging_sla_days: number;
  quarantine_backlog_gate: number;
  backfill_complete: boolean;
  quarantine_aged: boolean;
  quarantine_backlog_ok: boolean;
  quarterly_unlocked: boolean;
  quarterly_full_due: boolean;
  first_quarterly_completed: boolean;
  first_quarterly_milestone_at: string | null;
  unlock_recorded: boolean;
  runbook_ack_recorded: boolean;
  cta_eligible: boolean;
};

export type FirstQuarterlyRunbookResult = {
  disposition: 'recorded' | 'already_recorded' | 'failed';
  stepKind?: FirstQuarterlyRunbookStepKind;
  evidenceId?: string;
  evidenceSha256?: string;
  gatesUnlocked?: boolean;
  ctaEligible?: boolean;
  error?: string;
};

export type FirstQuarterlyOpsReport = {
  contractVersion: 'phase43-v1' | string;
  gates: FirstQuarterlyGates;
  cta: {
    eligible: boolean;
    label: string;
    quarterly_unlocked: boolean;
    first_quarterly_completed: boolean;
    quarterly_full_due: boolean;
  };
  runbook: Array<Record<string, unknown>>;
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

export async function recordArchiveCampaignOpsMilestone(input: {
  eventKind: ArchiveCampaignOpsEventKind;
  campaignId?: string | null;
  campaignKind?: ArchiveCampaignKind | null;
  gateReason?: string | null;
  remainingUnhashed?: number | null;
  quarantineBacklog?: number | null;
  quarantineOldestDays?: number | null;
  progressPct?: number | null;
  recordedBy?: string | null;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string | null;
}): Promise<ArchiveCampaignOpsMilestoneResult> {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'record_docusign_campaign_ops_milestone_phase42',
    {
      p_event_kind: input.eventKind,
      p_campaign_id: input.campaignId ?? null,
      p_campaign_kind: input.campaignKind ?? null,
      p_gate_reason: input.gateReason ?? null,
      p_remaining_unhashed: input.remainingUnhashed ?? null,
      p_quarantine_backlog: input.quarantineBacklog ?? null,
      p_quarantine_oldest_days: input.quarantineOldestDays ?? null,
      p_progress_pct: input.progressPct ?? null,
      p_recorded_by: input.recordedBy ?? null,
      p_metadata: input.metadata ?? {},
      p_idempotency_key: input.idempotencyKey ?? null,
    },
  );
  if (error) {
    return { disposition: 'failed', error: error.message };
  }
  const row = data as {
    disposition?: 'recorded' | 'already_recorded';
    event_id?: string;
    event_kind?: ArchiveCampaignOpsEventKind;
    evidence_sha256?: string;
    first_quarterly_milestone?: boolean;
  } | null;
  return {
    disposition: row?.disposition ?? 'recorded',
    eventKind: row?.event_kind,
    eventId: row?.event_id,
    evidenceSha256: row?.evidence_sha256,
    firstQuarterlyMilestone: row?.first_quarterly_milestone ?? false,
  };
}

async function maybeRecordCampaignOpsMilestone(input: {
  disposition: ArchiveCampaignResult['disposition'];
  campaignKind: ArchiveCampaignKind;
  campaignId?: string;
  status?: string;
  gateReason?: string | null;
  remainingUnhashed?: number;
  quarantineBacklog?: number;
  progressPct?: number;
  recordedBy?: string | null;
}): Promise<ArchiveCampaignOpsMilestoneResult | null> {
  if (
    input.disposition !== 'gated' &&
    input.disposition !== 'already_complete' &&
    !(input.disposition === 'claimed' && input.status === 'completed')
  ) {
    return null;
  }

  let eventKind: ArchiveCampaignOpsEventKind | null = null;
  if (input.disposition === 'gated') {
    eventKind =
      input.gateReason === 'quarantine_aging'
        ? 'quarantine_aging_breach'
        : 'campaign_gated';
  } else if (input.campaignKind === 'legacy_backfill_completion') {
    eventKind =
      (input.remainingUnhashed ?? 0) <= 0
        ? 'backfill_completed'
        : 'backfill_gate_cleared';
  } else if (input.campaignKind === 'quarterly_full_integrity') {
    eventKind = 'quarterly_completed';
  }
  if (!eventKind || !input.campaignId) {
    return { disposition: 'skipped' };
  }

  return recordArchiveCampaignOpsMilestone({
    eventKind,
    campaignId: input.campaignId,
    campaignKind: input.campaignKind,
    gateReason: input.gateReason,
    remainingUnhashed: input.remainingUnhashed,
    quarantineBacklog: input.quarantineBacklog,
    progressPct: input.progressPct,
    recordedBy: input.recordedBy,
    metadata: {
      contract_version: 'phase42-v1',
      disposition: input.disposition,
      status: input.status ?? null,
    },
    idempotencyKey: `phase42:ops:${eventKind}:${input.campaignId}:${input.disposition}`,
  });
}

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
    const opsMilestone = await maybeRecordCampaignOpsMilestone({
      disposition: 'gated',
      campaignKind: input.campaignKind,
      campaignId: claim.campaign_id,
      status: claim.status,
      gateReason: claim.gate_reason,
      remainingUnhashed: claim.gate_remaining_unhashed,
      quarantineBacklog: claim.gate_quarantine_backlog,
      progressPct: claim.progress_pct,
      recordedBy: input.requestedBy,
    });
    return {
      ok: true,
      disposition: 'gated',
      campaignId: claim.campaign_id,
      status: claim.status,
      progressPct: claim.progress_pct,
      gateReason: claim.gate_reason,
      remainingUnhashed: claim.gate_remaining_unhashed,
      quarantineBacklog: claim.gate_quarantine_backlog,
      opsMilestone,
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
    const opsMilestone = await maybeRecordCampaignOpsMilestone({
      disposition: 'already_complete',
      campaignKind: input.campaignKind,
      campaignId: claim.campaign_id,
      status: 'completed',
      remainingUnhashed: claim.gate_remaining_unhashed,
      quarantineBacklog: claim.gate_quarantine_backlog,
      progressPct: claim.progress_pct ?? 100,
      recordedBy: input.requestedBy,
    });
    return {
      ok: true,
      disposition: 'already_complete',
      campaignId: claim.campaign_id,
      status: 'completed',
      progressPct: claim.progress_pct ?? 100,
      remainingUnhashed: claim.gate_remaining_unhashed,
      quarantineBacklog: claim.gate_quarantine_backlog,
      opsMilestone,
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
  const opsMilestone = await maybeRecordCampaignOpsMilestone({
    disposition: 'claimed',
    campaignKind: input.campaignKind,
    campaignId: claim.campaign_id,
    status: finished?.status,
    remainingUnhashed: finished?.gate_remaining_unhashed,
    quarantineBacklog: finished?.gate_quarantine_backlog,
    progressPct: finished?.progress_pct,
    recordedBy: input.requestedBy,
  });
  return {
    ok: governance.ok || governance.claimed > 0,
    disposition: 'claimed',
    campaignId: claim.campaign_id,
    status: finished?.status,
    progressPct: finished?.progress_pct,
    remainingUnhashed: finished?.gate_remaining_unhashed,
    quarantineBacklog: finished?.gate_quarantine_backlog,
    opsMilestone,
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

export async function getArchiveCampaignOpsReport(input: {
  firmWide: boolean;
}) {
  const emptyReadiness: ArchiveCampaignOpsReadiness = {
    backfill_complete: false,
    quarterly_unlocked: false,
    ops_ready: false,
    quarantine_aging_breach: false,
    quarantine_backlog_high: false,
    remaining_unhashed: 0,
    quarantine_backlog: 0,
    quarantine_oldest_days: 0,
    quarterly_full_due: false,
    aging_sla_days: 45,
    quarantine_backlog_gate: 25,
    first_quarterly_milestone_at: null,
    last_ops_event_at: null,
    last_full_scan_at: null,
  };
  if (!input.firmWide) {
    return {
      contractVersion: 'phase42-v1' as const,
      readiness: emptyReadiness,
      milestones: [] as Array<Record<string, unknown>>,
      agingQueue: [] as ArchiveQuarantineAgingRow[],
      error: undefined as string | undefined,
    };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'get_docusign_archive_campaign_ops_phase42',
    { p_entity_id: null },
  );
  const report = data as {
    contract_version?: string;
    readiness?: Partial<ArchiveCampaignOpsReadiness>;
    milestones?: Array<Record<string, unknown>>;
    aging_queue?: ArchiveQuarantineAgingRow[];
  } | null;
  return {
    contractVersion: (report?.contract_version as 'phase42-v1') ?? 'phase42-v1',
    readiness: {
      ...emptyReadiness,
      ...(report?.readiness ?? {}),
    },
    milestones: report?.milestones ?? [],
    agingQueue: report?.aging_queue ?? [],
    error: error?.message,
  };
}

export async function listArchiveQuarantineAging(input: {
  firmWide: boolean;
  limit?: number;
}) {
  if (!input.firmWide) {
    return {
      rows: [] as ArchiveQuarantineAgingRow[],
      error: undefined as string | undefined,
    };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'list_docusign_archive_quarantine_aging_phase42',
    {
      p_limit: input.limit ?? 25,
      p_entity_id: null,
    },
  );
  return {
    rows: (data as ArchiveQuarantineAgingRow[] | null) ?? [],
    error: error?.message,
  };
}

const emptyFirstQuarterlyGates: FirstQuarterlyGates = {
  contract_version: 'phase43-v1',
  remaining_unhashed: 0,
  quarantine_backlog: 0,
  quarantine_oldest_days: 0,
  aging_sla_days: 45,
  quarantine_backlog_gate: 25,
  backfill_complete: false,
  quarantine_aged: false,
  quarantine_backlog_ok: false,
  quarterly_unlocked: false,
  quarterly_full_due: false,
  first_quarterly_completed: false,
  first_quarterly_milestone_at: null,
  unlock_recorded: false,
  runbook_ack_recorded: false,
  cta_eligible: false,
};

export async function evaluateFirstQuarterlyGates(input: {
  firmWide: boolean;
}): Promise<{ gates: FirstQuarterlyGates; error?: string }> {
  if (!input.firmWide) {
    return { gates: emptyFirstQuarterlyGates };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'evaluate_docusign_first_quarterly_gates_phase43',
    { p_entity_id: null },
  );
  return {
    gates: {
      ...emptyFirstQuarterlyGates,
      ...((data as Partial<FirstQuarterlyGates> | null) ?? {}),
    },
    error: error?.message,
  };
}

export async function getFirstQuarterlyOpsReport(input: {
  firmWide: boolean;
}): Promise<FirstQuarterlyOpsReport> {
  if (!input.firmWide) {
    return {
      contractVersion: 'phase43-v1',
      gates: emptyFirstQuarterlyGates,
      cta: {
        eligible: false,
        label: 'Run first quarterly (gated)',
        quarterly_unlocked: false,
        first_quarterly_completed: false,
        quarterly_full_due: false,
      },
      runbook: [],
    };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'get_docusign_first_quarterly_ops_phase43',
    { p_entity_id: null },
  );
  const report = data as {
    contract_version?: string;
    gates?: Partial<FirstQuarterlyGates>;
    cta?: Partial<FirstQuarterlyOpsReport['cta']>;
    runbook?: Array<Record<string, unknown>>;
  } | null;
  const gates = {
    ...emptyFirstQuarterlyGates,
    ...(report?.gates ?? {}),
  };
  return {
    contractVersion: report?.contract_version ?? 'phase43-v1',
    gates,
    cta: {
      eligible: report?.cta?.eligible ?? gates.cta_eligible,
      label: report?.cta?.label ?? 'Run first quarterly (gated)',
      quarterly_unlocked:
        report?.cta?.quarterly_unlocked ?? gates.quarterly_unlocked,
      first_quarterly_completed:
        report?.cta?.first_quarterly_completed ??
        gates.first_quarterly_completed,
      quarterly_full_due:
        report?.cta?.quarterly_full_due ?? gates.quarterly_full_due,
    },
    runbook: report?.runbook ?? [],
    error: error?.message,
  };
}

export async function recordFirstQuarterlyRunbook(input: {
  stepKind: FirstQuarterlyRunbookStepKind;
  campaignId?: string | null;
  recordedBy?: string | null;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string | null;
}): Promise<FirstQuarterlyRunbookResult> {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'record_docusign_first_quarterly_runbook_phase43',
    {
      p_step_kind: input.stepKind,
      p_campaign_id: input.campaignId ?? null,
      p_recorded_by: input.recordedBy ?? null,
      p_metadata: input.metadata ?? {},
      p_idempotency_key: input.idempotencyKey ?? null,
      p_entity_id: null,
    },
  );
  if (error) {
    return { disposition: 'failed', error: error.message };
  }
  const row = data as {
    disposition?: 'recorded' | 'already_recorded';
    evidence_id?: string;
    step_kind?: FirstQuarterlyRunbookStepKind;
    evidence_sha256?: string;
    gates_unlocked?: boolean;
    cta_eligible?: boolean;
  } | null;
  return {
    disposition: row?.disposition ?? 'recorded',
    stepKind: row?.step_kind,
    evidenceId: row?.evidence_id,
    evidenceSha256: row?.evidence_sha256,
    gatesUnlocked: row?.gates_unlocked,
    ctaEligible: row?.cta_eligible,
  };
}

async function maybeRecordFirstQuarterlyUnlock(input: {
  recordedBy?: string | null;
  campaignId?: string | null;
}): Promise<FirstQuarterlyRunbookResult | null> {
  const { gates, error } = await evaluateFirstQuarterlyGates({ firmWide: true });
  if (error) {
    return { disposition: 'failed', error };
  }
  await recordFirstQuarterlyRunbook({
    stepKind: 'gates_evaluated',
    campaignId: input.campaignId,
    recordedBy: input.recordedBy,
    metadata: {
      contract_version: 'phase43-v1',
      quarterly_unlocked: gates.quarterly_unlocked,
      cta_eligible: gates.cta_eligible,
    },
    idempotencyKey: `phase43:fq:gates_evaluated:${new Date().toISOString().slice(0, 10)}`,
  });
  if (!gates.quarterly_unlocked) {
    return null;
  }
  if (gates.unlock_recorded) {
    return {
      disposition: 'already_recorded',
      stepKind: 'unlock_recorded',
      gatesUnlocked: true,
      ctaEligible: gates.cta_eligible,
    };
  }
  const unlock = await recordFirstQuarterlyRunbook({
    stepKind: 'unlock_recorded',
    campaignId: input.campaignId,
    recordedBy: input.recordedBy,
    metadata: {
      contract_version: 'phase43-v1',
      remaining_unhashed: gates.remaining_unhashed,
      quarantine_aged: gates.quarantine_aged,
    },
    idempotencyKey: 'phase43:fq:unlock_recorded:v1',
  });
  if (unlock.disposition !== 'failed' && gates.cta_eligible) {
    await recordArchiveCampaignOpsMilestone({
      eventKind: 'backfill_gate_cleared',
      campaignId: input.campaignId,
      campaignKind: 'quarterly_full_integrity',
      remainingUnhashed: gates.remaining_unhashed,
      quarantineBacklog: gates.quarantine_backlog,
      quarantineOldestDays: gates.quarantine_oldest_days,
      recordedBy: input.recordedBy,
      metadata: {
        contract_version: 'phase43-v1',
        source: 'first_quarterly_unlock',
      },
      idempotencyKey: 'phase43:ops:backfill_gate_cleared:first_quarterly_unlock',
    });
  }
  return unlock;
}

export async function runFirstQuarterlyGatedOps(input: {
  trigger: 'cron' | 'manual';
  requestedBy?: string | null;
  workerId?: string;
  force?: boolean;
  limit?: number;
  acknowledgeRunbook?: boolean;
}): Promise<
  ArchiveCampaignResult & {
    firstQuarterly?: {
      gates: FirstQuarterlyGates;
      runbookUnlock?: FirstQuarterlyRunbookResult | null;
      runbookAck?: FirstQuarterlyRunbookResult | null;
      runbookStarted?: FirstQuarterlyRunbookResult | null;
      runbookCompleted?: FirstQuarterlyRunbookResult | null;
      ctaEligible: boolean;
    };
  }
> {
  const { gates, error: gatesError } = await evaluateFirstQuarterlyGates({
    firmWide: true,
  });
  if (gatesError) {
    return {
      ok: false,
      disposition: 'failed',
      error: gatesError,
      firstQuarterly: {
        gates,
        ctaEligible: false,
      },
    };
  }

  const runbookUnlock = await maybeRecordFirstQuarterlyUnlock({
    recordedBy: input.requestedBy,
  });

  if (!gates.quarterly_unlocked) {
    const gatedTick = await runArchiveCampaignTick({
      campaignKind: 'quarterly_full_integrity',
      trigger: input.trigger,
      requestedBy: input.requestedBy,
      workerId: input.workerId,
      force: input.force ?? false,
      limit: input.limit,
    });
    return {
      ...gatedTick,
      disposition: gatedTick.disposition === 'not_due' ? 'not_due' : 'gated',
      gateReason:
        gatedTick.gateReason ??
        (!gates.backfill_complete
          ? 'legacy_backfill_incomplete'
          : !gates.quarantine_aged
            ? 'quarantine_aging'
            : 'quarantine_backlog_high'),
      remainingUnhashed:
        gatedTick.remainingUnhashed ?? gates.remaining_unhashed,
      quarantineBacklog:
        gatedTick.quarantineBacklog ?? gates.quarantine_backlog,
      firstQuarterly: {
        gates,
        runbookUnlock,
        ctaEligible: false,
      },
    };
  }

  // After the first quarterly milestone, fall through to the Phase 41/42 tick
  // with unlock evidence only — do not re-emit first-run runbook steps.
  if (gates.first_quarterly_completed) {
    const result = await runArchiveCampaignTick({
      campaignKind: 'quarterly_full_integrity',
      trigger: input.trigger,
      requestedBy: input.requestedBy,
      workerId: input.workerId,
      force: input.force ?? false,
      limit: input.limit,
    });
    return {
      ...result,
      firstQuarterly: {
        gates,
        runbookUnlock,
        ctaEligible: false,
      },
    };
  }

  let runbookAck: FirstQuarterlyRunbookResult | null = null;
  if (input.acknowledgeRunbook || input.trigger === 'manual') {
    runbookAck = await recordFirstQuarterlyRunbook({
      stepKind: 'runbook_ack',
      recordedBy: input.requestedBy,
      metadata: {
        contract_version: 'phase43-v1',
        trigger: input.trigger,
      },
      idempotencyKey: `phase43:fq:runbook_ack:${input.trigger}:${input.requestedBy ?? 'cron'}`,
    });
  }

  const runbookStarted = await recordFirstQuarterlyRunbook({
    stepKind: 'first_quarterly_started',
    recordedBy: input.requestedBy,
    metadata: {
      contract_version: 'phase43-v1',
      trigger: input.trigger,
      cta_eligible: gates.cta_eligible,
    },
    idempotencyKey: 'phase43:fq:first_quarterly_started:v1',
  });

  const result = await runArchiveCampaignTick({
    campaignKind: 'quarterly_full_integrity',
    trigger: input.trigger,
    requestedBy: input.requestedBy,
    workerId: input.workerId,
    force: input.force ?? false,
    limit: input.limit,
  });

  let runbookCompleted: FirstQuarterlyRunbookResult | null = null;
  if (
    result.disposition === 'already_complete' ||
    (result.disposition === 'claimed' && result.status === 'completed') ||
    result.opsMilestone?.firstQuarterlyMilestone
  ) {
    runbookCompleted = await recordFirstQuarterlyRunbook({
      stepKind: 'first_quarterly_completed',
      campaignId: result.campaignId,
      recordedBy: input.requestedBy,
      metadata: {
        contract_version: 'phase43-v1',
        disposition: result.disposition,
        progress_pct: result.progressPct ?? null,
      },
      idempotencyKey: `phase43:fq:first_quarterly_completed:${result.campaignId ?? 'none'}`,
    });
  }

  return {
    ...result,
    firstQuarterly: {
      gates,
      runbookUnlock,
      runbookAck,
      runbookStarted,
      runbookCompleted,
      ctaEligible: gates.cta_eligible,
    },
  };
}
