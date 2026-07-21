import { createPersistClient } from '@/lib/supabase/persist-client';
import { listRecentEnvelopes } from '@/lib/docusign/envelopes';
import {
  DOCUSIGN_RECONCILIATION_MAX_PAGES,
  DOCUSIGN_RECONCILIATION_PAGE_SIZE,
  toReconciliationEvidence,
  validateReconciliationPagination,
} from '@/lib/docusign/reconciliation-contracts';
import { randomUUID } from 'crypto';

export type DocuSignReconciliationRow = {
  envelope_id: string;
  operation_kind: string;
  doc_id: string | null;
  entity_id: string | null;
  provider_status: string | null;
  local_document_status: string | null;
  reconciliation_state: string;
  issue_code: string | null;
  last_reconciled_at: string | null;
};

export async function reconcileDocuSignEnvelopes(input: {
  trigger: 'cron' | 'manual' | 'webhook_recovery';
  requestedBy?: string | null;
  days?: number;
  maxPages?: number;
  workerId?: string;
}): Promise<{
  ok: boolean;
  run_id?: string;
  seen: number;
  matched: number;
  unmapped: number;
  manual_review: number;
  pages: number;
  checkpoint?: number | null;
  completed?: boolean;
  error?: string;
}> {
  const sb = await createPersistClient();
  const days = Math.min(Math.max(input.days ?? 30, 1), 90);
  const maxPages = Math.min(
    Math.max(input.maxPages ?? DOCUSIGN_RECONCILIATION_MAX_PAGES, 1),
    DOCUSIGN_RECONCILIATION_MAX_PAGES,
  );
  const workerId =
    input.workerId?.trim().slice(0, 100) || `reconcile-${randomUUID()}`;
  const { data: runData, error: runError } = await sb.rpc(
    'claim_docusign_reconciliation_batch',
    {
      p_trigger_source: input.trigger,
      p_requested_by: input.requestedBy ?? null,
      p_worker_id: workerId,
      p_window_days: days,
      p_lease_seconds: 240,
    },
  );
  const claim = runData as
    | {
        disposition: 'claimed' | 'busy' | 'retry_not_due' | 'exhausted';
        run_id?: string;
        retry_at?: string;
        retry_attempts?: number;
        run?: {
          run_id: string;
          lease_token: string;
          cursor_start_position: number;
          next_page_no: number;
          seen: number;
          matched: number;
          unmapped: number;
          manual_review: number;
          window_from: string;
          window_to: string;
        };
      }
    | null;
  const run = claim?.disposition === 'claimed' ? claim.run : null;
  if (runError || !run?.lease_token) {
    return {
      ok: false,
      run_id: claim?.run_id,
      seen: 0,
      matched: 0,
      unmapped: 0,
      manual_review: 0,
      pages: 0,
      error:
        runError?.message ||
        (claim?.disposition === 'busy'
          ? `Reconciliation busy until ${claim.retry_at ?? 'lease expiry'}`
          : claim?.disposition === 'retry_not_due'
            ? `Reconciliation retry not due until ${claim.retry_at ?? 'scheduled time'}`
            : claim?.disposition === 'exhausted'
              ? `Reconciliation retry cap exhausted after ${claim.retry_attempts ?? 0} attempts`
              : 'Could not start reconciliation run'),
    };
  }
  let seen = Number(run.seen ?? 0);
  let matched = Number(run.matched ?? 0);
  let unmapped = Number(run.unmapped ?? 0);
  let manualReview = Number(run.manual_review ?? 0);
  let cursor = Number(run.cursor_start_position ?? 0);
  let pageNo = Number(run.next_page_no ?? 0);
  let pages = 0;
  try {
    for (let page = 0; page < maxPages; page += 1) {
      const result = await listRecentEnvelopes({
        count: DOCUSIGN_RECONCILIATION_PAGE_SIZE,
        startPosition: cursor,
        fromDate: run.window_from,
        toDate: run.window_to,
      });
      if (!result.ok) throw new Error(result.error);
      const paginationCheck = validateReconciliationPagination({
        pagination: result.pagination,
        itemCount: result.envelopes.length,
        expectedStartPosition: cursor,
      });
      if (!paginationCheck.ok) {
        const { data: driftData, error: driftError } = await sb.rpc(
          'commit_docusign_reconciliation_page',
          {
            p_run_id: run.run_id,
            p_lease_token: run.lease_token,
            p_page_no: pageNo,
            p_start_position: result.pagination.startPosition,
            p_next_start_position: result.pagination.nextStartPosition,
            p_provider_total: result.pagination.totalSetSize,
            p_result_count: result.pagination.resultSetSize,
            p_end_position: result.pagination.endPosition,
            p_items: result.envelopes.map(toReconciliationEvidence),
          },
        );
        if (driftError) throw new Error(driftError.message);
        const drift = driftData as { error_code?: string };
        return {
          ok: false,
          run_id: run.run_id,
          seen,
          matched,
          unmapped,
          manual_review: manualReview,
          pages,
          checkpoint: cursor,
          completed: false,
          error: drift.error_code || paginationCheck.error,
        };
      }
      const { data: commitData, error: commitError } = await sb.rpc(
        'commit_docusign_reconciliation_page',
        {
          p_run_id: run.run_id,
          p_lease_token: run.lease_token,
          p_page_no: pageNo,
          p_start_position: result.pagination.startPosition,
          p_next_start_position: result.pagination.nextStartPosition,
          p_provider_total: result.pagination.totalSetSize,
          p_result_count: result.pagination.resultSetSize,
          p_end_position: result.pagination.endPosition,
          p_items: result.envelopes.map(toReconciliationEvidence),
        },
      );
      if (commitError) throw new Error(commitError.message);
      const commit = commitData as {
        ok?: boolean;
        error_code?: string;
        seen?: number;
        matched?: number;
        unmapped?: number;
        manual_review?: number;
        next_start_position?: number | null;
      };
      if (commit.ok === false) {
        return {
          ok: false,
          run_id: run.run_id,
          seen,
          matched,
          unmapped,
          manual_review: manualReview,
          pages,
          checkpoint: cursor,
          completed: false,
          error: commit.error_code || 'Reconciliation page rejected',
        };
      }
      pages += 1;
      seen += Number(commit.seen ?? result.envelopes.length);
      matched += Number(commit.matched ?? 0);
      unmapped += Number(commit.unmapped ?? 0);
      manualReview += Number(commit.manual_review ?? 0);
      const next = result.pagination.nextStartPosition;
      console.info('docusign_reconciliation_page_committed', {
        run_id: run.run_id,
        page_no: pageNo,
        count: result.envelopes.length,
        next_start_position: next,
      });
      if (next == null) {
        const { data: finish, error: finishError } = await sb.rpc(
          'finish_docusign_reconciliation_batch',
          { p_run_id: run.run_id, p_lease_token: run.lease_token },
        );
        if (finishError) throw new Error(finishError.message);
        const final = finish as {
          ok?: boolean;
          error_code?: string;
          seen?: number;
          matched?: number;
          unmapped?: number;
          manual_review?: number;
        };
        if (final.ok === false) {
          return {
            ok: false,
            run_id: run.run_id,
            seen,
            matched,
            unmapped,
            manual_review: manualReview,
            pages,
            checkpoint: cursor,
            completed: false,
            error: final.error_code || 'Reconciliation finish rejected',
          };
        }
        return {
          ok: true,
          run_id: run.run_id,
          seen: Number(final.seen ?? seen),
          matched: Number(final.matched ?? matched),
          unmapped: Number(final.unmapped ?? unmapped),
          manual_review: Number(final.manual_review ?? manualReview),
          pages,
          checkpoint: null,
          completed: true,
        };
      }
      cursor = next;
      pageNo += 1;
    }
    const { error: deferError } = await sb.rpc(
      'fail_docusign_reconciliation_batch',
      {
        p_run_id: run.run_id,
        p_lease_token: run.lease_token,
        p_error_code: 'invocation_page_limit',
        p_error_message: `Invocation checkpointed after ${pages} page(s)`,
        p_retryable: true,
      },
    );
    if (deferError) throw new Error(deferError.message);
    return {
      ok: true,
      run_id: run.run_id,
      seen,
      matched,
      unmapped,
      manual_review: manualReview,
      pages,
      checkpoint: cursor,
      completed: false,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Reconciliation failed';
    const retryable =
      !/replay conflict|cursor.page drift|permission|invalid/i.test(message);
    const { error: failError } = await sb.rpc(
      'fail_docusign_reconciliation_batch',
      {
        p_run_id: run.run_id,
        p_lease_token: run.lease_token,
        p_error_code:
          error instanceof Error ? error.name.slice(0, 100) : 'unknown',
        p_error_message: message,
        p_retryable: retryable,
      },
    );
    console.error('docusign_reconciliation_failed', {
      run_id: run.run_id,
      page_no: pageNo,
      checkpoint: cursor,
      retryable,
      error: message,
      fail_rpc_error: failError?.message,
    });
    return {
      ok: false,
      run_id: run.run_id,
      seen,
      matched,
      unmapped,
      manual_review: manualReview,
      pages,
      checkpoint: cursor,
      completed: false,
      error: failError
        ? `${message} · failure checkpoint error: ${failError.message}`
        : message,
    };
  }
}

export async function listDocuSignReconciliation(input?: {
  limit?: number;
  entityId?: string | null;
  firmWide?: boolean;
}): Promise<DocuSignReconciliationRow[]> {
  const sb = await createPersistClient();
  let query = sb
    .from('os_docusign_envelopes')
    .select(
      'envelope_id, operation_kind, doc_id, entity_id, provider_status, local_document_status, reconciliation_state, issue_code, last_reconciled_at',
    )
    .order('updated_at', { ascending: false })
    .limit(input?.limit ?? 50);
  if (!input?.firmWide && input?.entityId) {
    query = query.eq('entity_id', input.entityId);
  } else if (!input?.firmWide) {
    return [];
  }
  const { data } = await query;
  return (data ?? []) as DocuSignReconciliationRow[];
}

export async function listDocuSignReconciliationRuns(limit = 10) {
  const sb = await createPersistClient();
  const { data } = await sb
    .from('os_docusign_reconciliation_runs')
    .select(
      'run_id, trigger_source, status, window_from, window_to, seen, matched, unmapped, manual_review, committed_pages, cursor_start_position, invocation_count, retry_attempts, max_attempts, next_attempt_at, replay_conflicts, drift_failures, last_checkpoint_at, last_failure_code, started_at, completed_at, error',
    )
    .order('started_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}
