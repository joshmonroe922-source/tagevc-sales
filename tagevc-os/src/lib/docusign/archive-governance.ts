import { createHash, randomUUID } from 'crypto';
import {
  assertPdfPayload,
  decodeBoundedBase64,
  describeArchiveBytes,
  DOCUSIGN_CERTIFICATE_MAX_BYTES,
  DOCUSIGN_COMBINED_ARCHIVE_MAX_BYTES,
} from '@/lib/docusign/archive-contracts';
import { archiveProviderCompletedDocument } from '@/lib/docusign/signed-docs';
import { createPersistClient } from '@/lib/supabase/persist-client';

const BUCKET = 'docusign-signed';
export const ARCHIVE_GOVERNANCE_BATCH_LIMIT = 5;

type BackfillItem = {
  item_cursor: string;
  envelope_id: string;
  document_id: string;
  entity_id: string | null;
  completed_event_id: string;
  lineage_id: string | null;
  provider_status: string;
};

type IntegrityItem = BackfillItem & {
  manifest_id: string;
  signed_file_id: string;
  file_kind: 'combined' | 'certificate';
  content_length: number;
  content_sha256: string;
  storage_path: string | null;
};

type Claim = {
  disposition: 'claimed' | 'busy' | 'retry_not_due' | 'exhausted';
  run_id?: string;
  retry_at?: string;
  lease_token?: string;
  fence_version?: number;
  items?: Array<BackfillItem | IntegrityItem>;
};

export type ArchiveGovernanceResult = {
  ok: boolean;
  run_id?: string;
  status?: string;
  claimed: number;
  succeeded: number;
  unavailable: number;
  drift: number;
  quarantined: number;
  checkpointed: boolean;
  error?: string;
};

function safeErrorCode(value: string | undefined, fallback: string): string {
  const normalized = (value || fallback)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
  return normalized || fallback;
}

async function loadIntegrityBytes(
  item: IntegrityItem,
): Promise<
  | {
      available: true;
      contentLength: number | null;
      contentSha256: string | null;
      validationCode?: string;
    }
  | { available: false; errorCode: string }
> {
  const sb = await createPersistClient();
  const { data: row, error } = await sb
    .from('os_docusign_signed_files')
    .select(
      'id, archive_manifest_id, envelope_id, doc_id, entity_id, file_kind, storage_path, content_base64, content_type',
    )
    .eq('id', item.signed_file_id)
    .eq('archive_manifest_id', item.manifest_id)
    .single();
  if (error || !row) {
    return { available: false, errorCode: 'signed_file_unavailable' };
  }
  if (
    row.envelope_id !== item.envelope_id ||
    row.doc_id !== item.document_id ||
    row.entity_id !== item.entity_id ||
    row.file_kind !== item.file_kind
  ) {
    return {
      available: true,
      contentLength: null,
      contentSha256: null,
      validationCode: 'signed_file_binding_changed',
    };
  }

  const maxBytes =
    item.file_kind === 'combined'
      ? DOCUSIGN_COMBINED_ARCHIVE_MAX_BYTES
      : DOCUSIGN_CERTIFICATE_MAX_BYTES;
  try {
    let buffer: Buffer;
    let contentType = row.content_type as string | null;
    if (row.storage_path) {
      const { data: blob, error: storageError } = await sb.storage
        .from(BUCKET)
        .download(row.storage_path);
      if (storageError || !blob) {
        return { available: false, errorCode: 'object_storage_unavailable' };
      }
      if (blob.size < 1 || blob.size > maxBytes) {
        return {
          available: true,
          contentLength: blob.size,
          contentSha256: null,
          validationCode: 'object_storage_size_invalid',
        };
      }
      buffer = Buffer.from(await blob.arrayBuffer());
      contentType = blob.type || contentType;
    } else if (typeof row.content_base64 === 'string') {
      buffer = decodeBoundedBase64(
        row.content_base64,
        maxBytes,
        'Inline signed archive',
      );
    } else {
      return { available: false, errorCode: 'archive_bytes_unavailable' };
    }
    const description = describeArchiveBytes(buffer);
    try {
      assertPdfPayload(buffer, contentType, 'Stored signed archive');
      return { available: true, ...description };
    } catch (caught) {
      return {
        available: true,
        ...description,
        validationCode: safeErrorCode(
          caught instanceof Error ? caught.message : undefined,
          'archive_validation_failed',
        ),
      };
    }
  } catch (caught) {
    return {
      available: true,
      contentLength: null,
      contentSha256: null,
      validationCode: safeErrorCode(
        caught instanceof Error ? caught.message : undefined,
        'archive_validation_failed',
      ),
    };
  }
}

export async function runArchiveGovernanceWorker(input: {
  runKind: 'legacy_backfill' | 'integrity_scan';
  scanMode?: 'sample' | 'full';
  trigger: 'cron' | 'manual';
  requestedBy?: string | null;
  workerId?: string;
  limit?: number;
}): Promise<ArchiveGovernanceResult> {
  const sb = await createPersistClient();
  const limit = Math.min(
    Math.max(input.limit ?? ARCHIVE_GOVERNANCE_BATCH_LIMIT, 1),
    10,
  );
  const workerId =
    input.workerId?.trim().slice(0, 100) || `archive-${randomUUID()}`;
  const scanMode =
    input.runKind === 'legacy_backfill' ? 'full' : input.scanMode ?? 'sample';
  const { data, error } = await sb.rpc(
    'claim_docusign_archive_governance_work',
    {
      p_run_kind: input.runKind,
      p_scan_mode: scanMode,
      p_trigger_source: input.trigger,
      p_requested_by: input.requestedBy ?? null,
      p_worker_id: workerId,
      p_limit: limit,
      p_lease_seconds: 300,
    },
  );
  const claim = data as Claim | null;
  if (
    error ||
    claim?.disposition !== 'claimed' ||
    !claim.run_id ||
    !claim.lease_token ||
    claim.fence_version == null
  ) {
    return {
      ok: false,
      run_id: claim?.run_id,
      claimed: 0,
      succeeded: 0,
      unavailable: 0,
      drift: 0,
      quarantined: 0,
      checkpointed: false,
      error:
        error?.message ||
        (claim?.disposition === 'busy'
          ? `Archive worker busy until ${claim.retry_at ?? 'lease expiry'}`
          : claim?.disposition === 'retry_not_due'
            ? `Archive retry not due until ${claim.retry_at ?? 'scheduled time'}`
            : claim?.disposition === 'exhausted'
              ? 'Archive retry cap exhausted'
              : 'Archive work claim failed'),
    };
  }

  const items = claim.items ?? [];
  let succeeded = 0;
  let unavailable = 0;
  let drift = 0;
  let quarantined = 0;
  try {
    for (const raw of items) {
      if (input.runKind === 'legacy_backfill') {
        const item = raw as BackfillItem;
        const archived = await archiveProviderCompletedDocument({
          envelopeId: item.envelope_id,
          documentId: item.document_id,
          entityId: item.entity_id,
          providerStatus: item.provider_status,
          sourceRequestId: `phase40:backfill:${createHash('sha256')
            .update(`${item.envelope_id}\u001f${item.document_id}`)
            .digest('hex')}`,
        });
        const certificateManifest =
          archived.coc?.ok === true
            ? archived.coc.archive_manifest_id ?? null
            : null;
        const errorCode =
          archived.ok && certificateManifest
            ? null
            : safeErrorCode(
                archived.ok ? archived.coc?.error : archived.error,
                'provider_unavailable',
              );
        const { data: committed, error: commitError } = await sb.rpc(
          'commit_docusign_archive_backfill_result',
          {
            p_run_id: claim.run_id,
            p_lease_token: claim.lease_token,
            p_fence_version: claim.fence_version,
            p_item_cursor: item.item_cursor,
            p_envelope_id: item.envelope_id,
            p_document_id: item.document_id,
            p_entity_id: item.entity_id,
            p_completed_event_id: item.completed_event_id,
            p_lineage_id: item.lineage_id,
            p_combined_manifest_id: archived.ok
              ? archived.archive_manifest_id ?? null
              : null,
            p_certificate_manifest_id: certificateManifest,
            p_error_code: errorCode,
          },
        );
        if (commitError) throw new Error(commitError.message);
        const outcome = committed as { outcome?: string };
        if (outcome.outcome === 'archived' && !errorCode) succeeded += 1;
        else unavailable += 1;
      } else {
        const item = raw as IntegrityItem;
        const observed = await loadIntegrityBytes(item);
        const { data: committed, error: commitError } = await sb.rpc(
          'commit_docusign_archive_integrity_result',
          {
            p_run_id: claim.run_id,
            p_lease_token: claim.lease_token,
            p_fence_version: claim.fence_version,
            p_item_cursor: item.item_cursor,
            p_manifest_id: item.manifest_id,
            p_completed_event_id: item.completed_event_id,
            p_lineage_id: item.lineage_id,
            p_observed_length: observed.available
              ? observed.contentLength
              : null,
            p_observed_sha256: observed.available
              ? observed.contentSha256
              : null,
            p_availability_code: observed.available
              ? null
              : observed.errorCode,
            p_validation_code: observed.available
              ? observed.validationCode ?? null
              : null,
          },
        );
        if (commitError) throw new Error(commitError.message);
        const outcome = (committed as { outcome?: string }).outcome;
        if (outcome === 'verified') succeeded += 1;
        else if (outcome === 'content_drift') {
          drift += 1;
          quarantined += 1;
        } else if (outcome === 'quarantined') {
          quarantined += 1;
        } else unavailable += 1;
      }
    }

    const hasMore = items.length === limit;
    const { data: finish, error: finishError } = await sb.rpc(
      'finish_docusign_archive_governance_run',
      {
        p_run_id: claim.run_id,
        p_lease_token: claim.lease_token,
        p_fence_version: claim.fence_version,
        p_has_more: hasMore,
      },
    );
    if (finishError) throw new Error(finishError.message);
    return {
      ok: unavailable === 0 && drift === 0,
      run_id: claim.run_id,
      status: (finish as { status?: string } | null)?.status,
      claimed: items.length,
      succeeded,
      unavailable,
      drift,
      quarantined,
      checkpointed: hasMore,
    };
  } catch (caught) {
    const message =
      caught instanceof Error ? caught.message : 'Archive governance failed';
    await sb.rpc('fail_docusign_archive_governance_run', {
      p_run_id: claim.run_id,
      p_lease_token: claim.lease_token,
      p_fence_version: claim.fence_version,
      p_error_code: safeErrorCode(message, 'archive_worker_failed'),
      p_error_detail: message.slice(0, 500),
      p_retryable: !/binding mismatch|content drift|permission/i.test(message),
    });
    return {
      ok: false,
      run_id: claim.run_id,
      claimed: items.length,
      succeeded,
      unavailable,
      drift,
      quarantined,
      checkpointed: false,
      error: message,
    };
  }
}

export async function listArchiveGovernance(input: {
  firmWide: boolean;
  entityId?: string | null;
}) {
  const sb = await createPersistClient();
  const runs = input.firmWide
    ? await sb
        .from('os_docusign_archive_governance_runs')
        .select(
          'run_id, run_kind, scan_mode, status, cursor_key, claimed_count, succeeded_count, unavailable_count, drift_count, quarantined_count, invocation_count, retry_attempts, next_attempt_at, last_error_code, started_at, completed_at',
        )
        .order('started_at', { ascending: false })
        .limit(12)
    : { data: [], error: null };
  let quarantineQuery = sb
    .from('os_docusign_archive_quarantine')
    .select(
      'quarantine_id, manifest_id, envelope_id, document_id, entity_id, file_kind, status, reason_code, expected_sha256, observed_sha256, row_version, opened_at',
    )
    .order('opened_at', { ascending: false })
    .limit(25);
  if (!input.firmWide && input.entityId) {
    quarantineQuery = quarantineQuery.eq('entity_id', input.entityId);
  } else if (!input.firmWide) {
    return { runs: [], quarantines: [], error: undefined };
  }
  const quarantines = await quarantineQuery;
  return {
    runs: runs.data ?? [],
    quarantines: quarantines.data ?? [],
    error: runs.error?.message || quarantines.error?.message,
  };
}
