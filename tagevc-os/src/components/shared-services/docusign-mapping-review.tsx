'use client';

import { useState, useTransition } from 'react';
import {
  proposeDocuSignMappingReviewAction,
  reviewDocuSignMappingReviewAction,
} from '@/app/(app)/shared-services/legal/docusign/actions';
import { Button } from '@/components/ui/button';
import type { DocuSignMappingConflict } from '@/lib/docusign/mapping-review-repo';

type Resolution = {
  resolution_id: string;
  envelope_id: string;
  decision: string;
  status: string;
  target_entity_id: string | null;
  target_doc_id: string | null;
  evidence_sha256: string;
  proposed_by: string;
  proposed_reason: string;
  expires_at: string;
  row_version: number;
};

function values(value: unknown): string {
  return Array.isArray(value) && value.length > 0 ? value.join(', ') : 'none';
}

export function DocuSignMappingReview({
  conflicts,
  resolutions,
  profileId,
  canResolve,
}: {
  conflicts: DocuSignMappingConflict[];
  resolutions: Resolution[];
  profileId: string | null;
  canResolve: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const run = (
    task: () => Promise<{ ok: boolean; message?: string; error?: string }>,
  ) => {
    startTransition(async () => {
      const result = await task();
      setMessage(result.ok ? result.message || 'Done' : result.error || 'Failed');
    });
  };

  if (conflicts.length === 0) return null;
  return (
    <section className="space-y-3 rounded-lg border border-rose-300 bg-rose-50/40 p-4">
      <div>
        <h2 className="font-semibold">Envelope mapping-review queue</h2>
        <p className="text-xs text-muted-foreground">
          Identity mapping is independent from send-intent review. Provider
          evidence is frozen, conflicts stay sticky, and approval cannot send
          or authorize a resend.
        </p>
      </div>
      {message ? <p className="text-xs">{message}</p> : null}
      {conflicts.map((conflict) => {
        const proposal = resolutions.find(
          (candidate) =>
            candidate.envelope_id === conflict.envelope_id &&
            candidate.status === 'awaiting_review',
        );
        const claims = conflict.identity_claims ?? {};
        return (
          <div
            className="space-y-2 rounded-md border bg-background p-3 text-xs"
            key={conflict.item_id}
          >
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-mono">{conflict.envelope_id}</span>
              <span>
                {conflict.identity_state} · {conflict.issue_code ?? 'conflict'} ·
                projection v{conflict.envelope?.row_version ?? 0}
              </span>
            </div>
            <p>
              Provider: {conflict.provider_status}
              {conflict.provider_status_at
                ? ` at ${new Date(conflict.provider_status_at).toLocaleString()}`
                : ''}
              {' · '}evidence {conflict.item_sha256.slice(0, 12)}…
            </p>
            <div className="grid gap-1 sm:grid-cols-2">
              <p>Entities: {values(claims.entity_ids)}</p>
              <p>Documents: {values(claims.doc_ids)}</p>
              <p>Send intents: {values(claims.send_intent_ids)}</p>
              <p>Lineages: {values(claims.lineage_ids)}</p>
              <p className="sm:col-span-2">
                Provider events: {values(claims.event_ids)}
              </p>
            </div>
            {!proposal && canResolve && conflict.envelope ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    const entityId = window.prompt('Target entity ID:');
                    if (!entityId) return;
                    const docId =
                      window.prompt('Target document ID (optional):') || null;
                    const sendIntentId =
                      window.prompt('Target send-intent UUID (optional):') ||
                      null;
                    const lineageId =
                      window.prompt('Target lineage UUID (optional):') || null;
                    const reason = window.prompt(
                      'Explain the identity assignment (20+ characters):',
                    );
                    if (!reason) return;
                    run(() =>
                      proposeDocuSignMappingReviewAction({
                        requestId: crypto.randomUUID(),
                        sourceItemId: conflict.item_id,
                        decision: 'assign_identity',
                        targetEntityId: entityId,
                        targetDocId: docId,
                        targetSendIntentId: sendIntentId,
                        targetLineageId: lineageId,
                        reason,
                        expectedEnvelopeVersion:
                          conflict.envelope?.row_version ?? 0,
                      }),
                    );
                  }}
                >
                  Propose identity mapping
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    const reason = window.prompt(
                      'Explain why this mapping must remain quarantined (20+ characters):',
                    );
                    if (!reason) return;
                    run(() =>
                      proposeDocuSignMappingReviewAction({
                        requestId: crypto.randomUUID(),
                        sourceItemId: conflict.item_id,
                        decision: 'retain_quarantine',
                        reason,
                        expectedEnvelopeVersion:
                          conflict.envelope?.row_version ?? 0,
                      }),
                    );
                  }}
                >
                  Propose retained quarantine
                </Button>
              </div>
            ) : null}
            {proposal ? (
              <div className="space-y-1 border-t pt-2">
                <p>
                  Pending {proposal.decision}
                  {proposal.target_entity_id
                    ? ` → ${proposal.target_entity_id}/${proposal.target_doc_id ?? 'no document'}`
                    : ''}
                  {' · '}frozen evidence {proposal.evidence_sha256.slice(0, 12)}
                  … · expires {new Date(proposal.expires_at).toLocaleString()}
                </p>
                <p>{proposal.proposed_reason}</p>
                {canResolve && profileId !== proposal.proposed_by ? (
                  <div className="flex gap-2">
                    {(['approve', 'reject'] as const).map((decision) => (
                      <Button
                        key={decision}
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => {
                          const statement = window.prompt(
                            `${decision === 'approve' ? 'Confirm' : 'Explain'} your independent mapping review (20+ characters):`,
                          );
                          if (!statement) return;
                          run(() =>
                            reviewDocuSignMappingReviewAction({
                              reviewRequestId: crypto.randomUUID(),
                              resolutionId: proposal.resolution_id,
                              reviewDecision: decision,
                              statement,
                              expectedResolutionVersion: proposal.row_version,
                              expectedEnvelopeVersion:
                                conflict.envelope?.row_version ?? 0,
                            }),
                          );
                        }}
                      >
                        {decision === 'approve' ? 'Approve mapping' : 'Reject'}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">
                    A different authorized actor must review this mapping.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
