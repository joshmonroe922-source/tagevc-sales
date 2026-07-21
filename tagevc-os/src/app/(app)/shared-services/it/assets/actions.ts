'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  assignHardware,
  createHardwareAsset,
  createSoftwareLicense,
  grantLicenseSeat,
  returnHardware,
  revokeLicenseSeat,
} from '@/lib/shared-services/it-assets-repo';
import { guardPermission } from '@/lib/rbac/session';
import {
  canAccessEntityId,
  entityScopeDeniedMessage,
} from '@/lib/rbac/entity-scope';
import { createPersistClient } from '@/lib/supabase/persist-client';

export type ItAssetActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

function revalidateAssets() {
  revalidatePath('/shared-services/it/assets');
  revalidatePath('/shared-services');
}

export async function createHardwareAction(
  _prev: ItAssetActionResult | null,
  formData: FormData,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;

  const parsed = z
    .object({
      kind: z.enum(['laptop', 'phone', 'peripheral', 'other_hardware']),
      entity_id: z.string().optional(),
      serial_number: z.string().optional(),
      model: z.string().optional(),
      notes: z.string().optional(),
      purchased_at: z.string().optional(),
      warranty_ends_at: z.string().optional(),
    })
    .safeParse({
      kind: formData.get('kind'),
      entity_id: formData.get('entity_id') || undefined,
      serial_number: formData.get('serial_number') || undefined,
      model: formData.get('model') || undefined,
      notes: formData.get('notes') || undefined,
      purchased_at: formData.get('purchased_at') || undefined,
      warranty_ends_at: formData.get('warranty_ends_at') || undefined,
    });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }

  const res = await createHardwareAsset({
    kind: parsed.data.kind,
    entity_id: parsed.data.entity_id || null,
    serial_number: parsed.data.serial_number || null,
    model: parsed.data.model || null,
    notes: parsed.data.notes || null,
    purchased_at: parsed.data.purchased_at || null,
    warranty_ends_at: parsed.data.warranty_ends_at || null,
  });
  if (!res.ok) return res;
  revalidateAssets();
  return { ok: true, message: `Created ${res.asset.asset_id}` };
}

export async function createLicenseAction(
  _prev: ItAssetActionResult | null,
  formData: FormData,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;

  const parsed = z
    .object({
      product_name: z.string().min(2),
      vendor: z.string().optional(),
      seat_count: z.coerce.number().int().positive().optional(),
      entity_id: z.string().optional(),
      renewal_date: z.string().optional(),
      cost_k: z.coerce.number().optional(),
      notes: z.string().optional(),
    })
    .safeParse({
      product_name: formData.get('product_name'),
      vendor: formData.get('vendor') || undefined,
      seat_count: formData.get('seat_count') || undefined,
      entity_id: formData.get('entity_id') || undefined,
      renewal_date: formData.get('renewal_date') || undefined,
      cost_k: formData.get('cost_k') || undefined,
      notes: formData.get('notes') || undefined,
    });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }

  const res = await createSoftwareLicense({
    product_name: parsed.data.product_name,
    vendor: parsed.data.vendor || null,
    seat_count: parsed.data.seat_count ?? null,
    entity_id: parsed.data.entity_id || null,
    renewal_date: parsed.data.renewal_date || null,
    cost_k: parsed.data.cost_k ?? null,
    notes: parsed.data.notes || null,
  });
  if (!res.ok) return res;
  revalidateAssets();
  return { ok: true, message: `Created ${res.license.license_id}` };
}

export async function assignHardwareAction(
  assetId: string,
  userId: string,
  note?: string,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;
  if (!userId.trim()) return { ok: false, error: 'User id required' };

  const res = await assignHardware({
    asset_id: assetId,
    user_id: userId.trim(),
    actor_id: gate.profile.id,
    note: note || null,
  });
  if (!res.ok) return res;
  revalidateAssets();
  return { ok: true, message: `Assigned ${assetId}` };
}

export async function returnHardwareAction(
  assetId: string,
  note?: string,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;

  const res = await returnHardware({
    asset_id: assetId,
    actor_id: gate.profile.id,
    note: note || null,
  });
  if (!res.ok) return res;
  revalidateAssets();
  return { ok: true, message: `Returned ${assetId}` };
}

export async function grantSeatAction(
  licenseId: string,
  userId?: string,
  note?: string,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;

  const res = await grantLicenseSeat({
    license_id: licenseId,
    user_id: userId?.trim() || null,
    actor_id: gate.profile.id,
    note: note || null,
  });
  if (!res.ok) return res;
  revalidateAssets();
  return { ok: true, message: `Granted seat on ${licenseId}` };
}

export async function revokeSeatAction(
  licenseId: string,
  userId?: string,
  note?: string,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;

  const res = await revokeLicenseSeat({
    license_id: licenseId,
    user_id: userId?.trim() || null,
    actor_id: gate.profile.id,
    note: note || null,
  });
  if (!res.ok) return res;
  revalidateAssets();
  return { ok: true, message: `Revoked seat on ${licenseId}` };
}

export async function startOffboardingAction(
  userId: string,
  entityId?: string,
  autoExecute?: boolean,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;
  const { startOffboarding } = await import(
    '@/lib/shared-services/it-offboarding'
  );
  const res = await startOffboarding({
    user_id: userId,
    entity_id: entityId || null,
    actor_id: gate.profile.id,
    auto_execute: Boolean(autoExecute),
  });
  if (!res.ok) return res;
  revalidateAssets();
  return {
    ok: true,
    message: `Offboarding ${res.run.run_id} · ${res.run.checklist.length} items · ${res.run.status}`,
  };
}

export async function executeOffboardingAction(
  runId: string,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;
  const { executeOffboarding } = await import(
    '@/lib/shared-services/it-offboarding'
  );
  const res = await executeOffboarding(runId, { actor_id: gate.profile.id });
  if (!res.ok) return res;
  revalidateAssets();
  return { ok: true, message: `Executed ${runId}` };
}

export async function startOffboardingFromTicketAction(
  ticketId: string,
  autoExecute?: boolean,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;
  const { startOffboardingFromHrTicket } = await import(
    '@/lib/shared-services/it-offboarding'
  );
  const res = await startOffboardingFromHrTicket({
    ticket_id: ticketId,
    actor_id: gate.profile.id,
    auto_execute: Boolean(autoExecute),
  });
  if (!res.ok) return res;
  revalidateAssets();
  return {
    ok: true,
    message: `Offboarding ${res.run.run_id} from ${ticketId}`,
  };
}

export async function completeOffboardingAction(
  runId: string,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;
  const { completeOffboarding } = await import(
    '@/lib/shared-services/it-offboarding'
  );
  const res = await completeOffboarding(runId);
  if (!res.ok) return res;
  revalidateAssets();
  return { ok: true, message: `Completed ${runId}` };
}

export async function scanInactiveOffboardingAction(): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;
  const { scanInactiveProfilesForOffboarding } = await import(
    '@/lib/shared-services/it-offboarding'
  );
  const res = await scanInactiveProfilesForOffboarding({
    limit: 20,
    auto_execute: true,
    actor_id: gate.profile.id,
  });
  revalidateAssets();
  return {
    ok: true,
    message: `Status scan: ${res.started} started, ${res.skipped} skipped (${res.scanned} inactive)`,
  };
}

export async function startOnboardingAction(
  userId: string,
  entityId?: string,
  autoExecute?: boolean,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;
  const { startOnboarding } = await import(
    '@/lib/shared-services/it-onboarding'
  );
  const res = await startOnboarding({
    user_id: userId,
    entity_id: entityId || null,
    actor_id: gate.profile.id,
    auto_execute: Boolean(autoExecute),
  });
  if (!res.ok) return res;
  revalidateAssets();
  return {
    ok: true,
    message: `Onboarding ${res.run.run_id} · ${res.run.checklist.length} items · ${res.run.status}`,
  };
}

export async function executeOnboardingAction(
  runId: string,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;
  const { executeOnboarding } = await import(
    '@/lib/shared-services/it-onboarding'
  );
  const res = await executeOnboarding(runId, { actor_id: gate.profile.id });
  if (!res.ok) return res;
  revalidateAssets();
  return { ok: true, message: `Executed onboarding ${runId}` };
}

export async function completeOnboardingAction(
  runId: string,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;
  const { completeOnboarding } = await import(
    '@/lib/shared-services/it-onboarding'
  );
  const res = await completeOnboarding(runId);
  if (!res.ok) return res;
  revalidateAssets();
  return { ok: true, message: `Completed onboarding ${runId}` };
}

export async function startOnboardingFromTicketAction(
  ticketId: string,
  autoExecute?: boolean,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;
  const { startOnboardingFromHrTicket } = await import(
    '@/lib/shared-services/it-onboarding'
  );
  const res = await startOnboardingFromHrTicket({
    ticket_id: ticketId,
    actor_id: gate.profile.id,
    auto_execute: Boolean(autoExecute),
  });
  if (!res.ok) return res;
  revalidateAssets();
  return {
    ok: true,
    message: `Onboarding ${res.run.run_id} from ${ticketId}`,
  };
}

export async function scanActiveOnboardingAction(): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;
  const { scanNewlyActiveProfilesForOnboarding } = await import(
    '@/lib/shared-services/it-onboarding'
  );
  const res = await scanNewlyActiveProfilesForOnboarding({
    limit: 20,
    lookback_days: 14,
    actor_id: gate.profile.id,
  });
  revalidateAssets();
  return {
    ok: true,
    message: `Active scan: ${res.started} started, ${res.skipped} skipped (${res.scanned} active in lookback)`,
  };
}

export async function scanLicenseRenewalsAction(): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;
  const { scanLicenseRenewals } = await import(
    '@/lib/shared-services/it-license-renewals'
  );
  const res = await scanLicenseRenewals({ within_days: 30 });
  if (res.error) return { ok: false, error: res.error };
  revalidateAssets();
  return {
    ok: true,
    message: `Renewals: ${res.due} due within 30d (${res.scanned} scanned)`,
  };
}

export async function bulkUpdateWarrantyAction(
  _prev: ItAssetActionResult | null,
  formData: FormData,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;

  const upload = formData.get('csv_file');
  let lines = String(formData.get('lines') ?? '');
  if (upload instanceof File && upload.size > 0) {
    if (upload.size > 512_000) {
      return { ok: false, error: 'CSV must be 500 KB or smaller' };
    }
    if (
      upload.type &&
      !['text/csv', 'text/plain', 'application/vnd.ms-excel'].includes(
        upload.type,
      )
    ) {
      return { ok: false, error: 'Upload a CSV or text file' };
    }
    lines = await upload.text();
  }
  if (!lines.trim()) {
    return {
      ok: false,
      error:
        'Upload CSV or paste lines: asset_id,warranty_ends_at (or serial,date)',
    };
  }
  if (Buffer.byteLength(lines, 'utf8') > 512_000) {
    return { ok: false, error: 'CSV input must be 500 KB or smaller' };
  }
  if (lines.split(/\r?\n/).length > 5_001) {
    return { ok: false, error: 'CSV is limited to 5,000 data rows' };
  }

  const { bulkUpdateWarranties } = await import(
    '@/lib/shared-services/it-assets-repo'
  );
  const res = await bulkUpdateWarranties({
    lines,
    actor_id: gate.profile.id,
    source_name:
      upload instanceof File && upload.size > 0 ? upload.name : 'pasted.csv',
  });
  const errHint =
    res.errors.length > 0 ? ` · errors: ${res.errors.slice(0, 3).join('; ')}` : '';
  if (!res.batch_id || res.failed > 0) {
    return {
      ok: false,
      error: `Warranty preview rejected: ${res.failed} failed${errHint}`,
    };
  }
  return {
    ok: true,
    message: `Warranty preview ready: ${res.updated} rows · batch ${res.batch_id} · hash ${res.source_sha256}`,
  };
}

export async function commitWarrantyImportAction(
  _prev: ItAssetActionResult | null,
  formData: FormData,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;
  const batchId = String(formData.get('batch_id') ?? '').trim();
  const sourceSha256 = String(formData.get('source_sha256') ?? '').trim();
  if (!batchId || !/^[a-f0-9]{64}$/.test(sourceSha256)) {
    return { ok: false, error: 'Valid batch ID and source hash are required' };
  }
  const { commitWarrantyImport } = await import(
    '@/lib/shared-services/it-assets-repo'
  );
  const result = await commitWarrantyImport({
    batch_id: batchId,
    source_sha256: sourceSha256,
    actor_id: gate.profile.id,
  });
  if (!result.ok) return result;
  revalidateAssets();
  return {
    ok: true,
    message: `Warranty batch committed atomically · ${result.changed} assets changed`,
  };
}

export async function approveIntuneActionAction(
  actionId: string,
  reason: string,
  expectedRowVersion: number,
  expectedMatchSha256: string,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('action:intune_retire');
  if (!gate.ok) return gate;
  if (!actionId.trim() || reason.trim().length < 5) {
    return { ok: false, error: 'Action and approval reason are required' };
  }
  const { approveIntuneAction } = await import(
    '@/lib/shared-services/it-assets-repo'
  );
  const result = await approveIntuneAction({
    action_id: actionId,
    actor_id: gate.profile.id,
    reason: reason.trim(),
    expected_row_version: expectedRowVersion,
    expected_match_sha256: expectedMatchSha256,
  });
  if (!result.ok) return result;
  revalidateAssets();
  return { ok: true, message: `Approved Intune action ${actionId}` };
}

export async function runIntuneWorkerAction(): Promise<ItAssetActionResult> {
  const gate = await guardPermission('action:intune_retire');
  if (!gate.ok) return gate;
  const { processIntuneActions } = await import(
    '@/lib/shared-services/it-intune-worker'
  );
  const result = await processIntuneActions();
  revalidateAssets();
  return result.ok
    ? {
        ok: true,
        message: `Intune worker claimed ${result.claimed} action(s)`,
      }
    : {
        ok: false,
        error:
          result.error ||
          `Intune worker completed with ${result.processed.filter((item) => item.status === 'failed').length} failure(s)`,
      };
}

export async function matchIntuneActionAction(
  actionId: string,
  assetId: string,
  expectedRowVersion: number,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('action:intune_retire');
  if (!gate.ok) return gate;
  const { matchIntuneAction } = await import(
    '@/lib/shared-services/it-assets-repo'
  );
  const result = await matchIntuneAction({
    action_id: actionId,
    asset_id: assetId,
    actor_id: gate.profile.id,
    expected_row_version: expectedRowVersion,
  });
  if (!result.ok) return result;
  revalidateAssets();
  return { ok: true, message: `Matched ${actionId} to ${assetId}` };
}

export async function cancelIntuneActionAction(
  actionId: string,
  reason: string,
  expectedRowVersion: number,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('action:intune_retire');
  if (!gate.ok) return gate;
  const { cancelIntuneAction } = await import(
    '@/lib/shared-services/it-assets-repo'
  );
  const result = await cancelIntuneAction({
    action_id: actionId,
    actor_id: gate.profile.id,
    reason,
    expected_row_version: expectedRowVersion,
  });
  if (!result.ok) return result;
  revalidateAssets();
  return { ok: true, message: `Cancelled Intune action ${actionId}` };
}

export async function retryIntuneActionAction(
  actionId: string,
  reason: string,
  expectedRowVersion: number,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('action:intune_retire');
  if (!gate.ok) return gate;
  const { retryIntuneAction } = await import(
    '@/lib/shared-services/it-assets-repo'
  );
  const result = await retryIntuneAction({
    action_id: actionId,
    actor_id: gate.profile.id,
    reason,
    expected_row_version: expectedRowVersion,
  });
  if (!result.ok) return result;
  revalidateAssets();
  return { ok: true, message: `Created governed retry for ${actionId}` };
}

export async function proposeIntuneAmbiguityResolutionAction(input: {
  actionId: string;
  decision: 'confirm_retired' | 'close_unresolved' | 'create_retry_child';
  reason: string;
  expectedActionVersion: number;
}): Promise<ItAssetActionResult> {
  const gate = await guardPermission('action:intune_manual_review');
  if (!gate.ok) return gate;
  const parsed = z
    .object({
      actionId: z.string().uuid(),
      decision: z.enum([
        'confirm_retired',
        'close_unresolved',
        'create_retry_child',
      ]),
      reason: z.string().trim().min(20).max(1000),
      expectedActionVersion: z.number().int().nonnegative(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid proposal' };
  }
  const service = await createPersistClient();
  const { data: action, error } = await service
    .from('os_it_intune_actions')
    .select('managed_device_id, entity_id, status')
    .eq('action_id', parsed.data.actionId)
    .single();
  if (error || !action || action.status !== 'manual_review') {
    return { ok: false, error: error?.message ?? 'Action is not quarantined' };
  }
  if (
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      action.entity_id,
    )
  ) {
    return {
      ok: false,
      error: entityScopeDeniedMessage(action.entity_id ?? 'firm-wide'),
    };
  }
  try {
    const { getIntuneAmbiguityEvidence } = await import(
      '@/lib/shared-services/it-mdm'
    );
    const evidence = await getIntuneAmbiguityEvidence(action.managed_device_id);
    const { proposeIntuneAmbiguityResolution } = await import(
      '@/lib/shared-services/it-assets-repo'
    );
    const result = await proposeIntuneAmbiguityResolution({
      action_id: parsed.data.actionId,
      actor_id: gate.profile.id,
      decision: parsed.data.decision,
      provider_evidence: evidence,
      reason: parsed.data.reason,
      expected_action_version: parsed.data.expectedActionVersion,
    });
    if (!result.ok) return result;
    revalidateAssets();
    return {
      ok: true,
      message:
        'Proposal quarantined for a different reviewer; expires in 30 minutes',
    };
  } catch (caught) {
    return {
      ok: false,
      error:
        caught instanceof Error ? caught.message : 'Graph evidence collection failed',
    };
  }
}

export async function reviewIntuneAmbiguityResolutionAction(input: {
  resolutionId: string;
  reviewDecision: 'approve' | 'reject';
  statement: string;
  expectedResolutionVersion: number;
  expectedActionVersion: number;
}): Promise<ItAssetActionResult> {
  const gate = await guardPermission('action:intune_manual_review');
  if (!gate.ok) return gate;
  const parsed = z
    .object({
      resolutionId: z.string().uuid(),
      reviewDecision: z.enum(['approve', 'reject']),
      statement: z.string().trim().min(20).max(1000),
      expectedResolutionVersion: z.number().int().nonnegative(),
      expectedActionVersion: z.number().int().nonnegative(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid review' };
  }
  const service = await createPersistClient();
  const { data: resolution, error } = await service
    .from('os_it_intune_ambiguity_resolutions')
    .select('action_id, entity_id, proposed_by')
    .eq('resolution_id', parsed.data.resolutionId)
    .single();
  if (error || !resolution) {
    return { ok: false, error: error?.message ?? 'Proposal not found' };
  }
  if (resolution.proposed_by === gate.profile.id) {
    return { ok: false, error: 'The proposer cannot review this proposal' };
  }
  if (
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      resolution.entity_id,
    )
  ) {
    return {
      ok: false,
      error: entityScopeDeniedMessage(resolution.entity_id ?? 'firm-wide'),
    };
  }
  const { data: action, error: actionError } = await service
    .from('os_it_intune_actions')
    .select('managed_device_id')
    .eq('action_id', resolution.action_id)
    .single();
  if (actionError || !action) {
    return { ok: false, error: actionError?.message ?? 'Action not found' };
  }
  try {
    const { getIntuneAmbiguityEvidence } = await import(
      '@/lib/shared-services/it-mdm'
    );
    const evidence = await getIntuneAmbiguityEvidence(action.managed_device_id);
    const { reviewIntuneAmbiguityResolution } = await import(
      '@/lib/shared-services/it-assets-repo'
    );
    const result = await reviewIntuneAmbiguityResolution({
      resolution_id: parsed.data.resolutionId,
      actor_id: gate.profile.id,
      review_decision: parsed.data.reviewDecision,
      provider_evidence: evidence,
      statement: parsed.data.statement,
      expected_resolution_version: parsed.data.expectedResolutionVersion,
      expected_action_version: parsed.data.expectedActionVersion,
    });
    if (!result.ok) return result;
    revalidateAssets();
    return {
      ok: true,
      message:
        parsed.data.reviewDecision === 'approve'
          ? 'Independent review committed atomically'
          : 'Proposal rejected; action remains quarantined',
    };
  } catch (caught) {
    return {
      ok: false,
      error:
        caught instanceof Error ? caught.message : 'Graph evidence collection failed',
    };
  }
}
