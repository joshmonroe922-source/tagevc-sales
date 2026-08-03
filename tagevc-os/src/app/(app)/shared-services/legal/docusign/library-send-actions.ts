'use server';

import { revalidatePath } from 'next/cache';
import { getSessionContext } from '@/lib/rbac/session';
import { sendLibraryDocumentForSignature } from '@/lib/docusign/library-send';
import type { AutofillRecordKind } from '@/lib/docusign/autofill';

export async function actionSendLibraryDocuSign(input: {
  entityId: string;
  docId: string;
  emailSubject: string;
  content: string;
  signerName: string;
  signerEmail: string;
  confirm: boolean;
  autofillKind?: AutofillRecordKind;
  autofillFields?: Record<string, string>;
  attachKind?:
    | 'hris_employee'
    | 'ap_vendor'
    | 'legal_matter'
    | 'client_org'
    | 'document_meta'
    | '';
  attachRecordId?: string;
}) {
  const session = await getSessionContext();
  if (!session) return { ok: false as const, error: 'Unauthorized' };

  const result = await sendLibraryDocumentForSignature({
    entityId: input.entityId,
    docId: input.docId,
    emailSubject: input.emailSubject,
    content: input.content,
    signerName: input.signerName,
    signerEmail: input.signerEmail,
    actorId: session.profile.id,
    explicitHumanConfirm: input.confirm === true,
    autofill: input.autofillFields
      ? {
          kind: input.autofillKind || 'generic',
          entityId: input.entityId,
          fields: input.autofillFields,
        }
      : null,
    attachTarget:
      input.attachKind && input.attachRecordId
        ? { kind: input.attachKind, recordId: input.attachRecordId }
        : null,
  });

  revalidatePath('/shared-services/legal/docusign');
  revalidatePath('/documents');
  return result;
}
