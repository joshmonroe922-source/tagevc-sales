import { describe, expect, it } from 'vitest';
import {
  DOCUSIGN_RECONCILIATION_MAX_PAGES,
  DOCUSIGN_RECONCILIATION_MAX_RUN_PAGES,
  DOCUSIGN_RECONCILIATION_MAX_ENVELOPES,
  DOCUSIGN_RECONCILIATION_PAGE_SIZE,
  isDocuSignStatusCompatible,
  toReconciliationEvidence,
  validateReconciliationPagination,
} from './reconciliation-contracts';

describe('DocuSign reconciliation evidence', () => {
  it('keeps invocation and page bounds explicit', () => {
    expect(DOCUSIGN_RECONCILIATION_PAGE_SIZE).toBe(100);
    expect(DOCUSIGN_RECONCILIATION_MAX_PAGES).toBe(3);
    expect(DOCUSIGN_RECONCILIATION_MAX_RUN_PAGES).toBe(100);
    expect(DOCUSIGN_RECONCILIATION_MAX_ENVELOPES).toBe(10_000);
  });

  it('removes all provider PII from durable page evidence', () => {
    const evidence = toReconciliationEvidence({
      envelopeId: 'env-1',
      status: 'Sent',
      emailSubject: 'Confidential acquisition',
      sentDateTime: '2026-07-21T12:00:00Z',
      completedDateTime: null,
      voidedDateTime: null,
      voidedReason: null,
      statusChangedDateTime: '2026-07-21T12:00:01Z',
      recipients: [
        {
          name: 'Sensitive Name',
          email: 'private@example.com',
          role: 'signers',
          status: 'sent',
          routingOrder: '1',
        },
      ],
    });

    expect(evidence).toEqual({
      envelope_id: 'env-1',
      provider_status: 'sent',
      provider_status_at: '2026-07-21T12:00:01Z',
    });
    expect(JSON.stringify(evidence)).not.toMatch(
      /Confidential|Sensitive|private@example/,
    );
  });

  it('accepts only contiguous, fully covered provider pages', () => {
    expect(
      validateReconciliationPagination({
        itemCount: 100,
        expectedStartPosition: 0,
        pagination: {
          resultSetSize: 100,
          totalSetSize: 150,
          startPosition: 0,
          endPosition: 99,
          nextStartPosition: 100,
        },
      }),
    ).toEqual({ ok: true });
    expect(
      validateReconciliationPagination({
        itemCount: 2,
        expectedStartPosition: 0,
        pagination: {
          resultSetSize: 2,
          totalSetSize: 3,
          startPosition: 0,
          endPosition: 1,
          nextStartPosition: 1,
        },
      }),
    ).toEqual({ ok: false, error: 'provider_next_cursor_drift' });
    expect(
      validateReconciliationPagination({
        itemCount: 50,
        expectedStartPosition: 100,
        pagination: {
          resultSetSize: 50,
          totalSetSize: 150,
          startPosition: 100,
          endPosition: 149,
          nextStartPosition: null,
        },
      }),
    ).toEqual({ ok: true });
    expect(
      validateReconciliationPagination({
        itemCount: 1,
        expectedStartPosition: 0,
        pagination: {
          resultSetSize: 1,
          totalSetSize: 10_001,
          startPosition: 0,
          endPosition: 0,
          nextStartPosition: 1,
        },
      }),
    ).toEqual({ ok: false, error: 'provider_count_or_cursor_drift' });
    expect(
      validateReconciliationPagination({
        itemCount: 40,
        expectedStartPosition: 100,
        pagination: {
          resultSetSize: 40,
          totalSetSize: 150,
          startPosition: 100,
          endPosition: 139,
          nextStartPosition: null,
        },
      }),
    ).toEqual({ ok: false, error: 'provider_truncated_final_page' });
    expect(
      validateReconciliationPagination({
        itemCount: 100,
        expectedStartPosition: 0,
        pagination: {
          resultSetSize: 99,
          totalSetSize: 150,
          startPosition: 0,
          endPosition: 99,
          nextStartPosition: 100,
        },
      }),
    ).toEqual({ ok: false, error: 'provider_count_or_cursor_drift' });
    expect(
      validateReconciliationPagination({
        itemCount: 2,
        expectedStartPosition: 0,
        pagination: {
          resultSetSize: 2,
          totalSetSize: 3,
          startPosition: 0,
          endPosition: 1,
          nextStartPosition: 2,
        },
      }),
    ).toEqual({ ok: true });
    expect(
      validateReconciliationPagination({
        itemCount: 0,
        expectedStartPosition: 0,
        pagination: {
          resultSetSize: 0,
          totalSetSize: 0,
          startPosition: 0,
          endPosition: 0,
          nextStartPosition: null,
        },
      }),
    ).toEqual({ ok: true });
  });

  it('uses provider/local status compatibility instead of equality', () => {
    expect(isDocuSignStatusCompatible('completed', 'Signed')).toBe(true);
    expect(isDocuSignStatusCompatible('completed', 'Completed')).toBe(true);
    expect(isDocuSignStatusCompatible('delivered', 'Sent')).toBe(true);
    expect(isDocuSignStatusCompatible('voided', 'Sent')).toBe(false);
    expect(isDocuSignStatusCompatible('sent', null)).toBe(true);
  });
});
