'use client';

import { useState, useTransition } from 'react';
import {
  backfillSignedStorageAction,
  emailCocAction,
  remindEnvelopeAction,
  reconcileDocuSignAction,
  refreshTemplateRecipientsAction,
  runReminderWorkerAction,
  runArchiveGovernanceAction,
  runArchiveCampaignAction,
  runFirstQuarterlyGatedOpsAction,
  reviewArchiveQuarantineAction,
  scheduleRemindersAction,
  sendFromTemplateAction,
  syncTemplatesAction,
  voidEnvelopeAction,
} from '@/app/(app)/shared-services/legal/docusign/actions';
import { Button } from '@/components/ui/button';

export function DocuSignHubActions({
  canWrite,
  canReconcile,
  canArchiveReview,
  firstQuarterlyCtaEligible = false,
  phase44DriftHealth,
  phase44BackfillHealth,
  phase44AlertDelivery,
  phase45GateProgress,
  phase45DriftBudgetHealth,
  phase45CadenceHealth,
  phase46FirstQuarterlyStatus,
  phase46RecurringStatus,
  phase46CadenceHealth,
  phase47RecurringRunStatus,
  phase47DriftPerformance,
}: {
  canWrite: boolean;
  canReconcile: boolean;
  canArchiveReview: boolean;
  firstQuarterlyCtaEligible?: boolean;
  phase44DriftHealth?: string;
  phase44BackfillHealth?: string;
  phase44AlertDelivery?: string;
  phase45GateProgress?: string;
  phase45DriftBudgetHealth?: string;
  phase45CadenceHealth?: string;
  phase46FirstQuarterlyStatus?: string;
  phase46RecurringStatus?: string;
  phase46CadenceHealth?: string;
  phase47RecurringRunStatus?: string;
  phase47DriftPerformance?: string;
}) {
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const showPhase44Badges =
    phase44DriftHealth != null ||
    phase44BackfillHealth != null ||
    phase44AlertDelivery != null;
  const showPhase45Badges =
    phase45GateProgress != null ||
    phase45DriftBudgetHealth != null ||
    phase45CadenceHealth != null;
  const showPhase46Badges =
    phase46FirstQuarterlyStatus != null ||
    phase46RecurringStatus != null ||
    phase46CadenceHealth != null;
  const showPhase47Badges =
    phase47RecurringRunStatus != null || phase47DriftPerformance != null;

  const badges =
    showPhase44Badges ||
    showPhase45Badges ||
    showPhase46Badges ||
    showPhase47Badges ? (
      <div className="flex flex-wrap gap-2 text-[11px]">
        {phase44DriftHealth ? (
          <span className="rounded border border-border/70 px-2 py-0.5 text-muted-foreground">
            Phase 44 drift {phase44DriftHealth}
          </span>
        ) : null}
        {phase44BackfillHealth ? (
          <span className="rounded border border-border/70 px-2 py-0.5 text-muted-foreground">
            Phase 44 backfill {phase44BackfillHealth}
          </span>
        ) : null}
        {phase44AlertDelivery ? (
          <span className="rounded border border-border/70 px-2 py-0.5 text-muted-foreground">
            Phase 44 alerts {phase44AlertDelivery}
          </span>
        ) : null}
        {phase45GateProgress ? (
          <span className="rounded border border-border/70 px-2 py-0.5 text-muted-foreground">
            Phase 45 gate {phase45GateProgress}
          </span>
        ) : null}
        {phase45DriftBudgetHealth ? (
          <span className="rounded border border-border/70 px-2 py-0.5 text-muted-foreground">
            Phase 45 drift budget {phase45DriftBudgetHealth}
          </span>
        ) : null}
        {phase45CadenceHealth ? (
          <span className="rounded border border-border/70 px-2 py-0.5 text-muted-foreground">
            Phase 45 cadence {phase45CadenceHealth}
          </span>
        ) : null}
        {phase46FirstQuarterlyStatus ? (
          <span className="rounded border border-border/70 px-2 py-0.5 text-muted-foreground">
            Phase 46 first quarterly {phase46FirstQuarterlyStatus}
          </span>
        ) : null}
        {phase46RecurringStatus ? (
          <span className="rounded border border-border/70 px-2 py-0.5 text-muted-foreground">
            Phase 46 recurring {phase46RecurringStatus}
          </span>
        ) : null}
        {phase46CadenceHealth ? (
          <span className="rounded border border-border/70 px-2 py-0.5 text-muted-foreground">
            Phase 46 cadence {phase46CadenceHealth}
          </span>
        ) : null}
        {phase47RecurringRunStatus ? (
          <span className="rounded border border-border/70 px-2 py-0.5 text-muted-foreground">
            Phase 47 recurring run {phase47RecurringRunStatus}
          </span>
        ) : null}
        {phase47DriftPerformance ? (
          <span className="rounded border border-border/70 px-2 py-0.5 text-muted-foreground">
            Phase 47 drift {phase47DriftPerformance}
          </span>
        ) : null}
      </div>
    ) : null;

  if (!canWrite) return badges;

  function run(
    fn: () => Promise<
      { ok: true; message?: string } | { ok: false; error: string }
    >,
  ) {
    setFlash(null);
    setErr(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) setFlash(res.message ?? 'Done');
      else setErr(res.error);
    });
  }

  return (
    <div className="space-y-2">
      {badges}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            const templateId = window.prompt('Template ID:');
            if (!templateId?.trim()) return;
            const email = window.prompt('Signer email:');
            if (!email?.trim()) return;
            const name = window.prompt('Signer name:', email) || email;
            const subject =
              window.prompt('Email subject:', 'Please sign') || 'Please sign';
            const role =
              window.prompt('Template role name:', 'Signer') || 'Signer';
            const entityId = window.prompt(
              'Entity ID (blank only for firm-wide send):',
              '',
            );
            run(() =>
              sendFromTemplateAction({
                requestId: crypto.randomUUID(),
                templateId: templateId.trim(),
                entityId: entityId?.trim() || null,
                emailSubject: subject,
                signerEmail: email.trim(),
                signerName: name.trim(),
                roleName: role.trim(),
                scheduleReminders: true,
              }),
            );
          }}
        >
          Quick send (1 role)
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            const envelopeId = window.prompt('Envelope ID to email CoC:');
            if (!envelopeId?.trim()) return;
            run(() => emailCocAction(envelopeId.trim()));
          }}
        >
          Email CoC
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            const envelopeId = window.prompt('Envelope ID to remind now:');
            if (!envelopeId?.trim()) return;
            run(() => remindEnvelopeAction(envelopeId.trim()));
          }}
        >
          Send reminder
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            const envelopeId = window.prompt(
              'Envelope ID to schedule +1/+3/+7d reminders:',
            );
            if (!envelopeId?.trim()) return;
            run(() => scheduleRemindersAction(envelopeId.trim()));
          }}
        >
          Schedule reminders
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => runReminderWorkerAction())}
        >
          Run reminder worker
        </Button>
        {canReconcile ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => reconcileDocuSignAction())}
            >
              Reconcile envelopes
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() =>
                  runArchiveGovernanceAction({ kind: 'legacy_backfill' }),
                )
              }
            >
              Backfill signed archives
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() =>
                  runArchiveGovernanceAction({
                    kind: 'integrity_scan',
                    mode: 'sample',
                  }),
                )
              }
            >
              Sample archive integrity
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() =>
                  runArchiveGovernanceAction({
                    kind: 'integrity_scan',
                    mode: 'full',
                  }),
                )
              }
            >
              Full archive integrity
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() =>
                  runArchiveCampaignAction({
                    kind: 'legacy_backfill_completion',
                  }),
                )
              }
            >
              Advance backfill campaign
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() =>
                  runArchiveCampaignAction({
                    kind: 'quarterly_full_integrity',
                  }),
                )
              }
            >
              Advance quarterly campaign
            </Button>
            {firstQuarterlyCtaEligible ? (
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={() => run(() => runFirstQuarterlyGatedOpsAction())}
              >
                Run first quarterly (gated)
              </Button>
            ) : null}
          </>
        ) : null}
        {canArchiveReview ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              const quarantineId = window.prompt('Archive quarantine ID:');
              if (!quarantineId?.trim()) return;
              const decision =
                window.prompt('Decision: acknowledge or resolve', 'acknowledge') ===
                'resolve'
                  ? 'resolve'
                  : 'acknowledge';
              const note = window.prompt(
                'Review note (at least 20 characters):',
              );
              if (!note?.trim()) return;
              const version = Number(
                window.prompt('Current row version:', '0') ?? '0',
              );
              run(() =>
                reviewArchiveQuarantineAction({
                  quarantineId: quarantineId.trim(),
                  decision,
                  note: note.trim(),
                  expectedRowVersion: Number.isInteger(version) ? version : 0,
                }),
              );
            }}
          >
            Review archive quarantine
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            const envelopeId = window.prompt('Envelope ID to void:');
            if (!envelopeId?.trim()) return;
            const reason = window.prompt(
              'Void reason (required for audit):',
              '',
            );
            if (!reason?.trim()) {
              setErr('Void reason is required');
              return;
            }
            const confirmed = window.confirm(
              'DocuSign void is irreversible. The envelope cannot be restored. Continue?',
            );
            if (!confirmed) return;
            run(() => voidEnvelopeAction(envelopeId.trim(), reason.trim()));
          }}
        >
          Void envelope
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            const templateId = window.prompt(
              'Template ID to refresh recipients/roles:',
            );
            if (!templateId?.trim()) return;
            run(() => refreshTemplateRecipientsAction(templateId.trim()));
          }}
        >
          Refresh template roles
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => syncTemplatesAction())}
        >
          Refresh templates
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => backfillSignedStorageAction())}
        >
          Backfill Storage
        </Button>
      </div>
      {(flash || err) && (
        <p className={`text-sm ${err ? 'text-destructive' : 'text-emerald-700'}`}>
          {err ?? flash}
        </p>
      )}
    </div>
  );
}
