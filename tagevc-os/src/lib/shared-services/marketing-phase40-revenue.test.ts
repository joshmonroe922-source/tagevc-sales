import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  authoritativeRevenuePageSchema,
  canonicalizeRevenueRecord,
  verifyRevenueAuthenticity,
} from './marketing-revenue-contracts';

const record = {
  source_record_id: 'ledger-line-1',
  revenue_event_id: 'invoice-1',
  source_revision: 1,
  entity_id: 'ENT-1',
  ad_account_id: 'MSA-1',
  external_account_id: 'act_9',
  source_campaign_id: 'source-campaign-4',
  external_campaign_id: 'campaign-4',
  cohort_key: '2026-07:qualified',
  cohort_window_start: '2026-07-01T00:00:00Z',
  cohort_window_end: '2026-07-31T23:59:59Z',
  currency: 'USD',
  amount_micros: '9007199254740991',
  attribution_model: 'last_touch' as const,
  attribution_window_days: 30,
  source_recorded_at: '2026-07-20T12:00:00Z',
};

describe('Phase 40 authoritative revenue contracts', () => {
  it('preserves exact micros and applies a deterministic transform', () => {
    const first = canonicalizeRevenueRecord(record);
    const second = canonicalizeRevenueRecord({ ...record });
    expect(first.amount_micros).toBe('9007199254740991');
    expect(first.source_payload_sha256).toBe(second.source_payload_sha256);
  });

  it('requires correction reasons and bounded provider pages', () => {
    expect(() =>
      canonicalizeRevenueRecord({ ...record, source_revision: 2 }),
    ).toThrow(/correction reason/i);
    expect(() =>
      authoritativeRevenuePageSchema.parse({
        contract_version: 'authoritative-revenue-v1',
        request_id: 'request-1',
        next_cursor: null,
        has_more: false,
        expected_records: 501,
        records: [],
      }),
    ).toThrow();
  });

  it('verifies HMAC signatures without accepting malformed hashes', () => {
    const body = JSON.stringify({ request_id: 'request-1' });
    const signature = createHmac('sha256', 'test-secret')
      .update(body)
      .digest('hex');
    expect(
      verifyRevenueAuthenticity({
        mode: 'hmac_sha256',
        rawBody: body,
        requestId: 'request-1',
        signature: `sha256=${signature}`,
        signatureSecret: 'test-secret',
      }).ok,
    ).toBe(true);
    expect(
      verifyRevenueAuthenticity({
        mode: 'hmac_sha256',
        rawBody: `${body} `,
        requestId: 'request-1',
        signature,
        signatureSecret: 'test-secret',
      }).ok,
    ).toBe(false);
  });

  it('enforces service-role mutation, leases, immutable receipts, and aligned comparisons', () => {
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase40_marketing_authoritative_revenue.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sql).toMatch(/for update skip locked/i);
    expect(sql).toMatch(/lease_token is distinct from p_lease_token/i);
    expect(sql).toMatch(/Canonical revenue and receipt rows are immutable/i);
    expect(sql).toMatch(/revoke all[\s\S]*from public,anon,authenticated/i);
    expect(sql).toMatch(/grant execute[\s\S]*to service_role/i);
    expect(sql).toMatch(
      /group by cohort_key,cohort_window_start,cohort_window_end,\s*currency,attribution_window_days/i,
    );
    expect(sql).toMatch(/count\(distinct event_set_sha256\)=1/i);
    expect(sql).toMatch(/differences do not establish causality/i);
    expect(sql).toMatch(/expected_records[\s\S]*observed_records/i);
    expect(sql).toMatch(/source_payload_sha256[\s\S]*canonical_sha256/i);
    expect(sql).toMatch(/correction_status in \('original','approved'\)/i);
  });

  it('records operational worker evidence', () => {
    const route = readFileSync(
      new URL(
        '../../app/api/marketing/revenue-ingestion-worker/route.ts',
        import.meta.url,
      ),
      'utf8',
    );
    expect(route).toMatch(/startOperationalWorker/);
    expect(route).toMatch(/finishOperationalWorker/);
    expect(route).toMatch(/bounded_pages: 10/);
    expect(route).toMatch(/bounded_records: 500/);
  });
});
