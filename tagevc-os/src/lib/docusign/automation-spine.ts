/**
 * DocuSign automation spine — library → autofill → send → library → DB attach.
 * Seams only until JWT + Connect are live with per-entity accounts.
 */

import {
  docusignEntityMappingReady,
  resolveDocuSignAccountId,
} from '@/lib/docusign/entity-accounts';
import { getDocuSignMode, isDocuSignConfigured } from '@/lib/docusign/config';

export const DOCUSIGN_AUTOMATION_STEPS = [
  'select_library_template',
  'autofill_from_record',
  'send_envelope',
  'connect_status',
  'pull_signed_pdf',
  'attach_to_record',
] as const;

export type DocuSignAutomationStep =
  (typeof DOCUSIGN_AUTOMATION_STEPS)[number];

export type AutomationSpineStatus = {
  mode: 'live' | 'mock';
  configured: boolean;
  entityMapping: ReturnType<typeof docusignEntityMappingReady>;
  steps: Array<{
    id: DocuSignAutomationStep;
    label: string;
    status: 'ready' | 'scaffold' | 'blocked';
    note: string;
  }>;
};

const STEP_META: Record<
  DocuSignAutomationStep,
  { label: string; scaffoldNote: string }
> = {
  select_library_template: {
    label: 'Select Document Library template',
    scaffoldNote: 'Template picker wired to Legal DocuSign hub + library ACL',
  },
  autofill_from_record: {
    label: 'Autofill from DB record',
    scaffoldNote: 'Merge fields from employee / vendor / deal / client_org',
  },
  send_envelope: {
    label: 'Send for e-signature',
    scaffoldNote: 'Uses entity DocuSign account when mapped',
  },
  connect_status: {
    label: 'Connect webhook status',
    scaffoldNote: '/api/docusign/connect HMAC verified events',
  },
  pull_signed_pdf: {
    label: 'Return signed PDF to library',
    scaffoldNote: 'signed-docs pull-back into Document Library',
  },
  attach_to_record: {
    label: 'Attach to source record',
    scaffoldNote: 'HRIS step / AP vendor / matter document_id',
  },
};

export function getDocuSignAutomationSpine(entityId?: string | null): AutomationSpineStatus {
  const configured = isDocuSignConfigured();
  const mode = getDocuSignMode();
  const entityMapping = docusignEntityMappingReady();
  const account = resolveDocuSignAccountId(entityId);

  return {
    mode,
    configured,
    entityMapping,
    steps: DOCUSIGN_AUTOMATION_STEPS.map((id) => {
      const meta = STEP_META[id];
      if (!configured) {
        return {
          id,
          label: meta.label,
          status: 'blocked' as const,
          note: 'DocuSign JWT/env not configured',
        };
      }
      if (
        (id === 'send_envelope' || id === 'attach_to_record') &&
        entityId &&
        !account.ready
      ) {
        return {
          id,
          label: meta.label,
          status: 'blocked' as const,
          note: `Missing DocuSign account for ${account.entityId}`,
        };
      }
      if (id === 'autofill_from_record' || id === 'attach_to_record') {
        return {
          id,
          label: meta.label,
          status: 'scaffold' as const,
          note: meta.scaffoldNote,
        };
      }
      return {
        id,
        label: meta.label,
        status: 'ready' as const,
        note: meta.scaffoldNote,
      };
    }),
  };
}
