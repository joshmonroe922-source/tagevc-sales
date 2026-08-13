'use client';

import {
  createThinkTankThreadAction,
  loadThinkTankDeskAction,
  removeThinkTankAttachmentAction,
  renameThinkTankThreadAction,
  sendThinkTankChat,
  uploadThinkTankAttachmentAction,
} from '@/app/(app)/think-tank/actions';
import { ThinkTankDesk } from '@/lib/platform/think-tank/think-tank-desk';

const ROLE_LABEL: Record<string, string> = {
  leadership: 'Leadership advisor',
  operator: 'Operator advisor',
  deal: 'Deal-team advisor',
  admin: 'Admin advisor',
};

export function ThinkTankClient({
  roleBand = 'deal',
  viewAsLabel = null,
  compact = false,
}: {
  /** Unused for SSR — desk loads client-side so home TTFB stays off AI. */
  initialMessages?: unknown;
  roleBand?: string;
  viewAsLabel?: string | null;
  compact?: boolean;
}) {
  const advisor =
    ROLE_LABEL[roleBand] ?? 'Personal advisor';
  const viewAs = viewAsLabel ? ` · view-as: ${viewAsLabel}` : '';

  return (
    <ThinkTankDesk
      portalKey="tage"
      compact={compact}
      copy={{
        subtitle: `Ask how to hit today’s goals and clear hot items${viewAs}`,
        intro:
          'Your personal operating advisor for Tage VC. Advice uses live firm context (funnel, tickets, portfolio). Name threads per report, strategy, or personal execution. Documents stay on that thread only. You remain the decision-maker — Think Tank does not execute privileged actions.',
        emptyHint:
          'Ask what to win today: deal actions, Shared Services backlog, portfolio risks, or approvals due. Or attach a PDF/DOCX for this thread.',
        chips: [
          'What should I win today?',
          'Where am I behind on goals this week?',
          'Prioritize my open service and deal queues.',
        ],
        advisorLabel: advisor,
      }}
      actions={{
        loadDesk: loadThinkTankDeskAction,
        sendChat: sendThinkTankChat,
        createThread: createThinkTankThreadAction,
        renameThread: renameThinkTankThreadAction,
        uploadAttachment: uploadThinkTankAttachmentAction,
        removeAttachment: removeThinkTankAttachmentAction,
      }}
    />
  );
}
