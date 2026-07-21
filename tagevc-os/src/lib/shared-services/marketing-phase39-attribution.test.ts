import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  decimalToMicros,
  paidRevenueEvidenceSchema,
} from './marketing-attribution';

const baseEvidence = {
  idempotency_key: 'phase39:test:ledger:1',
  entity_id: 'ENT-1',
  provider: 'meta_ads' as const,
  ad_account_id: 'MSA-1',
  external_account_id: 'act_9',
  campaign_id: 'CMP-1',
  external_campaign_id: '42',
  revenue_event_id: 'invoice-1',
  revenue_occurred_at: '2026-07-01T12:00:00Z',
  currency: 'usd',
  attributed_amount: '9007199254.740991',
  settled_amount: '0',
  settlement_status: 'pending' as const,
  expected_settlement_at: '2026-07-05T12:00:00Z',
  settled_at: null,
  attribution_window_days: 30,
  attribution_model: 'last_touch' as const,
  attribution_model_version: 'crm-last-touch-v3',
  source_system: 'finance_ledger',
  source_record_id: 'ledger-1',
  source_recorded_at: '2026-07-01T12:01:00Z',
  source_payload_json:
    '{"invoice_id":900719925474099312345,"amount":"9007199254.740991"}',
  revision: 1,
  supersedes_evidence_id: null,
};

describe('Phase 39 paid attribution evidence', () => {
  it('uses exact fixed-scale arithmetic beyond Number safe precision', () => {
    expect(decimalToMicros('9007199254.740991')).toBe(
      BigInt('9007199254740991'),
    );
    expect(
      decimalToMicros('0.100000') + decimalToMicros('0.200000'),
    ).toBe(decimalToMicros('0.300000'));
  });

  it('normalizes currency and scale without floating-point coercion', () => {
    const parsed = paidRevenueEvidenceSchema.parse(baseEvidence);
    expect(parsed.currency).toBe('USD');
    expect(parsed.attributed_amount).toBe('9007199254.740991');
    expect(parsed.settled_amount).toBe('0.000000');
    expect(parsed.source_payload_json).toContain('900719925474099312345');
  });

  it('rejects inconsistent settlement state and revision lineage', () => {
    expect(() =>
      paidRevenueEvidenceSchema.parse({
        ...baseEvidence,
        settlement_status: 'settled',
        settled_amount: '1',
        settled_at: null,
      }),
    ).toThrow(/Settlement status/);
    expect(() =>
      paidRevenueEvidenceSchema.parse({
        ...baseEvidence,
        revision: 2,
      }),
    ).toThrow(/Revision lineage/);
    expect(() =>
      paidRevenueEvidenceSchema.parse({
        ...baseEvidence,
        settlement_status: 'reversed',
      }),
    ).toThrow(/reversal revision/);
    expect(() =>
      paidRevenueEvidenceSchema.parse({
        ...baseEvidence,
        source_recorded_at: '2026-06-30T12:00:00Z',
      }),
    ).toThrow(/chronologically consistent/);
  });

  it('keeps evidence append-only, entity-scoped, and currency-grouped', () => {
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase39_marketing_attribution_settlement.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sql).toMatch(/before update or delete/i);
    expect(sql).toMatch(/before truncate/i);
    expect(sql).toMatch(/append-only/i);
    expect(sql).toMatch(/public\.can_access_entity\(entity_id\)/);
    expect(sql).toMatch(/group by currency/);
    expect(sql).toMatch(/campaign binding mismatch/);
    expect(sql).toMatch(/Idempotency key was replayed with different evidence/);
    expect(sql).toMatch(/source_payload_verified/);
    expect(sql).toMatch(/security invoker/);
    expect(sql).toMatch(/at time zone 'UTC'/);
    expect(sql).toMatch(/from public, anon, authenticated, service_role/);
    expect(sql).toMatch(
      /ranked_all[\s\S]*current_rank[\s\S]*latest_window[\s\S]*current_rank = 1/,
    );
    expect(sql).toMatch(/binding_sha256 is distinct from v_binding_hash/);
    expect(sql).toMatch(/limit 200/);
  });
});
