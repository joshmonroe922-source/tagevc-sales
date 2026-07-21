import { describe, expect, it } from 'vitest';
import {
  canonicalEvidenceHash,
  classifyPaidFailure,
  linkedinAccountAccessConfirmed,
  parseLinkedInAccountPage,
  parseLinkedInCampaignPage,
  parseMetaAccountPage,
  parseMetaCampaignPage,
  parseRetryAfter,
  reconcileAccountDailyTotals,
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

  it('normalizes Meta account-level daily totals', () => {
    expect(
      parseMetaAccountPage({
        raw: {
          data: [
            {
              account_id: 'act_9',
              date_start: '2026-07-01',
              date_stop: '2026-07-01',
              impressions: '100',
              clicks: '4',
              spend: '12.340000',
            },
          ],
        },
        expectedExternalAccountId: '9',
        windowStart: '2026-07-01',
        windowEnd: '2026-07-07',
      }).rows[0],
    ).toMatchObject({
      metric_date: '2026-07-01',
      spend: '12.340000',
      conversions: null,
    });
  });

  it('rejects mismatched Meta account identity', () => {
    expect(() =>
      parseMetaAccountPage({
        raw: {
          data: [
            {
              account_id: 'act_10',
              date_start: '2026-07-01',
              date_stop: '2026-07-01',
              impressions: '0',
              clicks: '0',
              spend: '0',
            },
          ],
        },
        expectedExternalAccountId: 'act_9',
        windowStart: '2026-07-01',
        windowEnd: '2026-07-01',
      }),
    ).toThrow(/did not match/);
  });

  it('accepts the current optional LinkedIn paging envelope', () => {
    expect(
      parseLinkedInCampaignPage({
        raw: { elements: [], paging: { start: 0, count: 0, links: [] } },
        knownCampaignIds: new Set(['42']),
        windowStart: '2026-07-01',
        windowEnd: '2026-07-07',
      }).rows,
    ).toEqual([]);
  });

  it('rejects unexpected LinkedIn pagination instead of truncating', () => {
    expect(() =>
      parseLinkedInCampaignPage({
        raw: {
          elements: [],
          paging: {
            links: [{ rel: 'next', href: 'https://api.linkedin.com/next' }],
          },
        },
        knownCampaignIds: new Set(['42']),
        windowStart: '2026-07-01',
        windowEnd: '2026-07-07',
      }),
    ).toThrow(/non-paginated/);
  });

  it('normalizes LinkedIn account totals and explicit zero dates', () => {
    const raw = {
      elements: [
        {
          pivotValues: ['urn:li:sponsoredAccount:9'],
          dateRange: {
            start: { year: 2026, month: 7, day: 1 },
            end: { year: 2026, month: 7, day: 1 },
          },
          impressions: 10,
          clicks: 2,
          costInLocalCurrency: '0.300000',
          externalWebsiteConversions: '1',
        },
      ],
    };
    const provider = parseLinkedInAccountPage({
      raw,
      expectedExternalAccountId: '9',
      windowStart: '2026-07-01',
      windowEnd: '2026-07-02',
    }).rows;
    const reconciled = reconcileAccountDailyTotals({
      providerRows: provider,
      campaignRows: [
        {
          external_campaign_id: '42',
          metric_date: '2026-07-01',
          impressions: 10,
          clicks: 2,
          spend: '0.1',
          conversions: '1',
        },
        {
          external_campaign_id: '43',
          metric_date: '2026-07-01',
          impressions: 0,
          clicks: 0,
          spend: '0.200000',
          conversions: '0',
        },
      ],
      windowStart: '2026-07-01',
      windowEnd: '2026-07-02',
    });
    expect(reconciled).toEqual([
      expect.objectContaining({
        metric_date: '2026-07-01',
        spend: '0.300000',
        mapping_status: 'complete',
      }),
      expect.objectContaining({
        metric_date: '2026-07-02',
        impressions: 0,
        spend: '0.000000',
        mapping_status: 'complete',
      }),
    ]);
    expect(() =>
      parseLinkedInAccountPage({
        raw,
        expectedExternalAccountId: '10',
        windowStart: '2026-07-01',
        windowEnd: '2026-07-02',
      }),
    ).toThrow(/exact bound/);
  });

  it('requires exact LinkedIn campaign identity and DAILY range', () => {
    const valid = {
      elements: [
        {
          pivotValues: ['urn:li:sponsoredCampaign:42'],
          dateRange: {
            start: { year: 2026, month: 7, day: 1 },
            end: { year: 2026, month: 7, day: 1 },
          },
          impressions: 1,
          clicks: 1,
          costInLocalCurrency: '1.000000',
          externalWebsiteConversions: '1',
        },
      ],
    };
    expect(
      parseLinkedInCampaignPage({
        raw: valid,
        knownCampaignIds: new Set(['42']),
        windowStart: '2026-07-01',
        windowEnd: '2026-07-01',
      }).rows[0].external_campaign_id,
    ).toBe('42');
    expect(() =>
      parseLinkedInCampaignPage({
        raw: {
          ...valid,
          elements: [
            {
              ...valid.elements[0],
              pivotValues: ['42'],
            },
          ],
        },
        knownCampaignIds: new Set(['42']),
        windowStart: '2026-07-01',
        windowEnd: '2026-07-01',
      }),
    ).toThrow(/exact expected/);
    expect(() =>
      parseLinkedInCampaignPage({
        raw: {
          ...valid,
          elements: [
            {
              ...valid.elements[0],
              dateRange: {
                ...valid.elements[0].dateRange,
                end: { year: 2026, month: 7, day: 2 },
              },
            },
          ],
        },
        knownCampaignIds: new Set(['42']),
        windowStart: '2026-07-01',
        windowEnd: '2026-07-02',
      }),
    ).toThrow(/identical start and end/);
    expect(() =>
      parseLinkedInCampaignPage({
        raw: {
          ...valid,
          elements: [
            {
              ...valid.elements[0],
              externalWebsiteConversions: '1.5',
            },
          ],
        },
        knownCampaignIds: new Set(['42']),
        windowStart: '2026-07-01',
        windowEnd: '2026-07-01',
      }),
    ).toThrow(/safe integer/);
  });

  it('confirms empty LinkedIn analytics only with exact fresh access', () => {
    expect(
      linkedinAccountAccessConfirmed(
        { elements: [{ id: 9 }, { id: 10 }] },
        'urn:li:sponsoredAccount:9',
      ),
    ).toBe(true);
    expect(
      linkedinAccountAccessConfirmed(
        { elements: [{ id: 10 }] },
        'urn:li:sponsoredAccount:9',
      ),
    ).toBe(false);
  });

  it('distinguishes mapping gaps from provider inconsistency', () => {
    const gap = reconcileAccountDailyTotals({
      providerRows: [
        {
          metric_date: '2026-07-01',
          impressions: 10,
          clicks: 2,
          spend: '1.000000',
          conversions: null,
        },
      ],
      campaignRows: [],
      windowStart: '2026-07-01',
      windowEnd: '2026-07-01',
    });
    expect(gap[0].mapping_status).toBe('gap');
    let inconsistency: unknown;
    try {
      reconcileAccountDailyTotals({
        providerRows: [
          {
            metric_date: '2026-07-01',
            impressions: 1,
            clicks: 0,
            spend: '0',
            conversions: null,
          },
        ],
        campaignRows: [
          {
            external_campaign_id: '42',
            metric_date: '2026-07-01',
            impressions: 2,
            clicks: 0,
            spend: '0',
            conversions: null,
          },
        ],
        windowStart: '2026-07-01',
        windowEnd: '2026-07-01',
      });
    } catch (error) {
      inconsistency = error;
    }
    expect(inconsistency).toMatchObject({ retryable: true });
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
