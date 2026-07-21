export const DOCUSIGN_RECONCILIATION_PAGE_SIZE = 100;
export const DOCUSIGN_RECONCILIATION_MAX_PAGES = 3;
export const DOCUSIGN_RECONCILIATION_MAX_RUN_PAGES = 100;
export const DOCUSIGN_RECONCILIATION_MAX_ENVELOPES = 10_000;

export type DocuSignReconciliationEvidenceItem = {
  envelope_id: string;
  provider_status: string;
  provider_status_at: string | null;
};

export type ReconciliationPagination = {
  resultSetSize: number;
  totalSetSize: number;
  startPosition: number;
  /** DocuSign defines this as the inclusive final position. */
  endPosition: number;
  nextStartPosition: number | null;
};

export function validateReconciliationPagination(input: {
  pagination: ReconciliationPagination;
  itemCount: number;
  expectedStartPosition: number;
}): { ok: true } | { ok: false; error: string } {
  const { pagination, itemCount, expectedStartPosition } = input;
  if (
    !Number.isInteger(itemCount) ||
    itemCount < 0 ||
    itemCount > DOCUSIGN_RECONCILIATION_PAGE_SIZE ||
    pagination.totalSetSize > DOCUSIGN_RECONCILIATION_MAX_ENVELOPES ||
    pagination.resultSetSize !== itemCount ||
    pagination.startPosition !== expectedStartPosition
  ) {
    return { ok: false, error: 'provider_count_or_cursor_drift' };
  }
  if (itemCount === 0) {
    return pagination.totalSetSize === 0 &&
      pagination.startPosition === 0 &&
      (pagination.endPosition === 0 || pagination.endPosition === -1) &&
      pagination.nextStartPosition == null
      ? { ok: true }
      : { ok: false, error: 'provider_zero_page_drift' };
  }
  if (
    pagination.endPosition !== pagination.startPosition + itemCount - 1 ||
    pagination.endPosition >= pagination.totalSetSize
  ) {
    return { ok: false, error: 'provider_count_or_cursor_drift' };
  }
  if (pagination.nextStartPosition == null) {
    return pagination.endPosition === pagination.totalSetSize - 1
      ? { ok: true }
      : { ok: false, error: 'provider_truncated_final_page' };
  }
  if (
    pagination.nextStartPosition !== pagination.endPosition + 1 ||
    pagination.endPosition >= pagination.totalSetSize - 1
  ) {
    return { ok: false, error: 'provider_next_cursor_drift' };
  }
  return { ok: true };
}

export function isDocuSignStatusCompatible(
  providerStatus: string | null | undefined,
  localStatus: string | null | undefined,
): boolean {
  if (!localStatus) return true;
  const provider = providerStatus?.trim().toLowerCase() || 'unknown';
  const local = localStatus.trim().toLowerCase();
  const compatible: Record<string, readonly string[]> = {
    created: ['created', 'draft'],
    sent: ['sent'],
    delivered: ['sent', 'delivered'],
    completed: ['signed', 'completed', 'executed'],
    voided: ['voided'],
    declined: ['declined'],
  };
  return (compatible[provider] ?? [provider]).includes(local);
}

/** Deliberately excludes provider subjects, recipients, and document data. */
export function toReconciliationEvidence<T extends {
  envelopeId: string;
  status: string;
  statusChangedDateTime: string | null;
}>(envelope: T): DocuSignReconciliationEvidenceItem {
  return {
    envelope_id: envelope.envelopeId,
    provider_status: envelope.status.toLowerCase(),
    provider_status_at: envelope.statusChangedDateTime,
  };
}
