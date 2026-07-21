import { describe, expect, it } from 'vitest';
import {
  canonicalEvidenceHash,
  classifyPaidFailure,
  parseLinkedInCampaignPage,
  parseMetaCampaignPage,
  parseRetryAfter,
} from './marketing-paid-contracts';

describe('paid provider contracts', () => {
  it('normalizes a valid Meta daily campaign row', () => {
    const result = parseMetaCampaignPage({
      raw: {
        data: [
          {
            campaign_id: '42',
            date_start: '2026-07-01',
            date_stop: '2026-07-01',
            impressions: '100',
            clicks: '4',
            spend: '12.340000',
            actions: [{ action_type: 'lead', value: '2' }],
          },
        ],
      },
      knownCampaignIds: new Set(['42']),
      conversionMetricByCampaign: new Map([['42', 'lead']]),
      windowStart: '2026-07-01',
      windowEnd: '2026-07-07',
    });
    expect(result.rows[0]).toMatchObject({
      impressions: 100,
      spend: '12.340000',
      conversions: '2',
    });
  });

  it('rejects malformed numeric values instead of coercing them to zero', () => {
    expect(() =>
      parseMetaCampaignPage({
        raw: {
          data: [
            {
              campaign_id: '42',
              date_start: '2026-07-01',
              date_stop: '2026-07-01',
              impressions: 'NaN',
              clicks: '0',
              spend: 'invalid',
            },
          ],
        },
        knownCampaignIds: new Set(['42']),
        conversionMetricByCampaign: new Map(),
        windowStart: '2026-07-01',
        windowEnd: '2026-07-07',
      }),
    ).toThrow(/non-negative/);
  });

  it('rejects LinkedIn paging that makes no progress', () => {
    expect(() =>
      parseLinkedInCampaignPage({
        raw: { elements: [], paging: { start: 0, count: 0, total: 5 } },
        knownCampaignIds: new Set(['42']),
        windowStart: '2026-07-01',
        windowEnd: '2026-07-07',
        requestedStart: 0,
      }),
    ).toThrow(/no progress/);
  });

  it('produces stable evidence hashes across object key order', () => {
    expect(canonicalEvidenceHash({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalEvidenceHash({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it('classifies provider and transport failures', () => {
    expect(
      classifyPaidFailure({
        status: 429,
        message: 'throttled',
        retryAfter: '60',
      }),
    ).toMatchObject({ retryable: true, retryAfterSeconds: 60 });
    expect(
      classifyPaidFailure({ status: 403, message: 'scope missing' }),
    ).toMatchObject({ retryable: false, errorClass: 'authorization' });
    expect(
      classifyPaidFailure({ message: 'socket closed' }),
    ).toMatchObject({ retryable: true, errorClass: 'transport' });
  });

  it('parses Retry-After HTTP dates', () => {
    expect(
      parseRetryAfter(
        'Tue, 21 Jul 2026 13:01:00 GMT',
        Date.parse('Tue, 21 Jul 2026 13:00:00 GMT'),
      ),
    ).toBe(60);
  });
});
