/**
 * Invoice attachment assembly — MD - Invoice Attachments.
 * Send order: Invoice PDF → entity defaults → customer defaults → extras.
 */

import { getEntityAttachmentDefaults } from '@/lib/af/master-data';
import type {
  EntityCode,
  InvoiceAttachmentDefault,
} from '@/lib/af/types';

export type CustomerAttachment = {
  customerId: string;
  documentType: string;
  displayName: string;
  fileRef: string;
  active: boolean;
};

export type InvoiceExtraAttachment = {
  id: string;
  invoiceId: string;
  fileRef: string;
  name: string;
  uploadedBy: string;
  uploadedAt: string;
};

export type AssembledAttachment = {
  source: 'invoice-pdf' | 'entity' | 'customer' | 'extra';
  displayName: string;
  fileRef: string;
  required: boolean;
  documentType?: string;
};

export type AssembleResult = {
  attachments: AssembledAttachment[];
  blocked: boolean;
  missingRequired: string[];
};

export function assembleInvoiceSendPacket(input: {
  entityCode: EntityCode;
  invoiceNumber: string;
  customerAttachments?: CustomerAttachment[];
  extras?: InvoiceExtraAttachment[];
  /** When false, treat missing fileRef as blocking for required docs. */
  filesPresent?: Record<string, boolean>;
}): AssembleResult {
  const attachments: AssembledAttachment[] = [
    {
      source: 'invoice-pdf',
      displayName: `Invoice ${input.invoiceNumber}.pdf`,
      fileRef: `invoices/${input.invoiceNumber}.pdf`,
      required: true,
      documentType: 'Invoice',
    },
  ];

  const entityDefaults = getEntityAttachmentDefaults(input.entityCode);
  const seen = new Set<string>();

  for (const d of entityDefaults) {
    const key = dedupeKey(d.fileRef, d.displayName);
    if (seen.has(key)) continue;
    seen.add(key);
    attachments.push({
      source: 'entity',
      displayName: d.displayName,
      fileRef: d.fileRef,
      required: d.requiredOnSend,
      documentType: d.documentType,
    });
  }

  for (const c of input.customerAttachments ?? []) {
    if (!c.active) continue;
    const key = dedupeKey(c.fileRef, c.displayName);
    if (seen.has(key)) continue;
    seen.add(key);
    attachments.push({
      source: 'customer',
      displayName: c.displayName,
      fileRef: c.fileRef,
      required: false,
      documentType: c.documentType,
    });
  }

  for (const e of input.extras ?? []) {
    const key = dedupeKey(e.fileRef, e.name);
    if (seen.has(key)) continue;
    seen.add(key);
    attachments.push({
      source: 'extra',
      displayName: e.name,
      fileRef: e.fileRef,
      required: false,
    });
  }

  const filesPresent = input.filesPresent ?? {};
  // Seed refs without uploaded bytes are tracked in go-live ENT-06;
  // block only when explicitly marked missing via filesPresent=false.
  const explicitMissing = attachments
    .filter((a) => a.required && a.source === 'entity')
    .filter((a) => filesPresent[a.fileRef] === false)
    .map((a) => a.displayName);

  return {
    attachments,
    blocked: explicitMissing.length > 0,
    missingRequired: explicitMissing,
  };
}

function dedupeKey(fileRef: string, name: string): string {
  return `${fileRef}|${name}`.toLowerCase();
}

export function requiredEntityAttachmentTypes(
  defaults: InvoiceAttachmentDefault[],
): string[] {
  return defaults.filter((d) => d.requiredOnSend).map((d) => d.documentType);
}
