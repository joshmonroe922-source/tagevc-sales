'use client';

import { useState, useTransition } from 'react';
import {
  proposeDocuSignManualReviewAction,
  reviewDocuSignManualReviewAction,
} from '@/app/(app)/shared-services/legal/docusign/actions';
import { Button } from '@/components/ui/button';
import { entityDisplayName } from '@/lib/entities/display-name';
type Intent = {
  intent_id: string;
  operation_kind: string;
  entity_id: string | null;
  provider_transaction_id: string;
  candidate_envelope_id: string | null;
  manual_review_reason: string | null;
  row_version: number;
};

type Resolution = {
  resolution_id: string;
  intent_id: string;
  decision: string;
  status: string;
  candidate_envelope_id: string | null;
  evidence_sha256: string;
  proposed_by: string;
  proposed_reason: string;
  expires_at: string;
  row_version: number;
};

export function DocuSignManualReview({
  intents,
  resolutions,
  profileId,
  canResolve,
}: {
  intents: Intent[];
  resolutions: Resolution[];
  profileId: string | null;
  canResolve: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const run = (task: () => Promise<{ ok: boolean; message?: string; error?: string }>) => {
    startTransition(async () => {
      const result = await task();
      setMessage(result.ok ? result.message || 'Done' : result.error || 'Failed');
    });
  };

  if (intents.length === 0) return null;
  return (
    <section className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/50 p-4">
      <div>
        <h2 className="font-semibold">Governed manual-review queue</h2>
        <p className="text-xs text-muted-foreground">
          Resolutions require fresh provider evidence and two different
          authorized actors. This workflow never sends or resends an envelope.
        </p>
      </div>
      {message ? <p className="text-xs">{message}</p> : null}
      {intents.map((intent) => {
        const proposal = resolutions.find(
          (resolution) =>
            resolution.intent_id === intent.intent_id &&
            resolution.status === 'awaiting_review',
        );
        return (
          <div className="space-y-2 rounded-md border bg-background p-3 text-xs" key={intent.intent_id}>
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-medium">
                {intent.operation_kind} ·{' '}
                {intent.entity_id
                  ? entityDisplayName(intent.entity_id)
                  : 'Firm-wide'}
              </span>
              <span>intent v{intent.row_version}</span>
            </div>
            <p className="font-mono">transaction {intent.provider_transaction_id}</p>
            <p>{intent.manual_review_reason || 'Provider outcome is ambiguous.'}</p>
            <p>
              Candidate: {intent.candidate_envelope_id || 'none discovered'}
            </p>
            {!proposal && canResolve ? (
              <div className="flex flex-wrap gap-2">
                {intent.candidate_envelope_id ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      const reason = window.prompt(
                        'Explain why this candidate should be bound (20+ characters):',
                      );
                      if (!reason) return;
                      run(() =>
                        proposeDocuSignManualReviewAction({
                          intentId: intent.intent_id,
                          decision: 'finalize_candidate',
                          candidateEnvelopeId: intent.candidate_envelope_id,
                          reason,
                          expectedIntentVersion: intent.row_version,
                        }),
                      );
                    }}
                  >
                    Propose candidate binding
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    const reason = window.prompt(
                      'Explain why this intent should close locally (20+ characters). Resend remains blocked:',
                    );
                    if (!reason) return;
                    run(() =>
                      proposeDocuSignManualReviewAction({
                        intentId: intent.intent_id,
                        decision: 'cancel_intent',
                        reason,
                        expectedIntentVersion: intent.row_version,
                      }),
                    );
                  }}
                >
                  Propose close without resend
                </Button>
              </div>
            ) : null}
            {proposal ? (
              <div className="space-y-1 border-t pt-2">
                <p>
                  Pending: {proposal.decision} · evidence{' '}
                  {proposal.evidence_sha256.slice(0, 12)}… · expires{' '}
                  {new Date(proposal.expires_at).toLocaleString()}
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
                            `${decision === 'approve' ? 'Confirm' : 'Explain'} your independent review (20+ characters):`,
                          );
                          if (!statement) return;
                          run(() =>
                            reviewDocuSignManualReviewAction({
                              resolutionId: proposal.resolution_id,
                              reviewDecision: decision,
                              statement,
                              expectedResolutionVersion: proposal.row_version,
                              expectedIntentVersion: intent.row_version,
                            }),
                          );
                        }}
                      >
                        {decision === 'approve' ? 'Approve' : 'Reject'}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">
                    A different authorized actor must review this proposal.
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
