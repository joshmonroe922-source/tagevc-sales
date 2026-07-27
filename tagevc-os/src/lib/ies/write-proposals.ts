/**
 * IES write proposal policy boundary.
 *
 * This module intentionally contains no provider mutation client. It creates
 * draft proposals and evaluates submission eligibility only. A future submit
 * adapter must call `evaluateIesSubmission` immediately before any IES request.
 */

import { getIesConfig } from '@/lib/ies/config';
import { createPersistClient } from '@/lib/supabase/persist-client';

export const IES_PROPOSAL_TYPES = [
  'journal_draft',
  'invoice_draft',
  'vendor_bill_draft',
  'checklist_note',
] as const;

export type IesProposalType = (typeof IES_PROPOSAL_TYPES)[number];

const FORBIDDEN_PAYLOAD_KEYS =
  /(payment|transfer|void|payroll|refund|money_movement)/i;

export function isSafeIesProposal(input: {
  proposalType: string;
  payload: Record<string, unknown>;
}): boolean {
  return (
    (IES_PROPOSAL_TYPES as readonly string[]).includes(input.proposalType) &&
    !FORBIDDEN_PAYLOAD_KEYS.test(JSON.stringify(input.payload))
  );
}

export function evaluateIesSubmission(input: {
  writeEnabled?: boolean;
  status: string;
  proposerId: string;
  approverIds: string[];
  proposalType: string;
  payload: Record<string, unknown>;
}): { ok: true } | { ok: false; error: string } {
  const enabled = input.writeEnabled ?? getIesConfig().writeEnabled;
  if (!enabled) {
    return { ok: false, error: 'IES_WRITE_ENABLED is not exactly 1' };
  }
  if (!isSafeIesProposal(input)) {
    return { ok: false, error: 'Proposal type or payload is forbidden' };
  }
  if (input.status !== 'approved') {
    return { ok: false, error: 'Proposal is not approved' };
  }
  const humans = new Set(
    input.approverIds.filter((id) => id && id !== input.proposerId),
  );
  if (humans.size < 2) {
    return {
      ok: false,
      error: 'Two distinct human approvers other than the proposer are required',
    };
  }
  return { ok: true };
}

export async function createIesWriteProposal(input: {
  proposalType: IesProposalType;
  entityId: string;
  payload: Record<string, unknown>;
  proposedBy: string;
}): Promise<{ ok: true; proposalId: string } | { ok: false; error: string }> {
  if (!/^ENT-[A-Z0-9-]{1,32}$/.test(input.entityId)) {
    return { ok: false, error: 'Invalid entity_id' };
  }
  if (!isSafeIesProposal({ proposalType: input.proposalType, payload: input.payload })) {
    return { ok: false, error: 'Proposal type or payload is forbidden' };
  }
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_ies_write_proposals')
      .insert({
        proposal_type: input.proposalType,
        entity_id: input.entityId,
        payload: input.payload,
        proposed_by: input.proposedBy,
        status: 'proposed',
      })
      .select('proposal_id')
      .single();
    if (error || !data?.proposal_id) {
      return {
        ok: false,
        error: error?.message ?? 'Proposal store unavailable',
      };
    }
    return { ok: true, proposalId: String(data.proposal_id) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Proposal failed',
    };
  }
}
