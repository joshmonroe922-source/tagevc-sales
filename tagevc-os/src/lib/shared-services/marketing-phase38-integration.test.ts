import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { authoritativePaidHeadlines } from './marketing-paid-reporting';

describe('Phase 38 paid integration boundaries', () => {
  it('does not create a mixed-currency headline spend', () => {
    expect(
      authoritativePaidHeadlines([
        {
          currency: 'USD',
          impressions: 100,
          clicks: 10,
          spend: 50,
          conversions: 1,
        },
        {
          currency: 'EUR',
          impressions: 100,
          clicks: 20,
          spend: 40,
          conversions: 2,
        },
      ]),
    ).toEqual({ spendK: null, ctr: 0.15 });
  });

  it('binds idempotency and supersession to the campaign hash', () => {
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase38_marketing_paid_reconciliation.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sql).toMatch(
      /v_account\.paid_connection_revision\s*\|\|\s*':'\s*\|\|\s*v_binding_sha/,
    );
    expect(sql).toMatch(
      /error_code = 'campaign_binding_changed'[\s\S]*status','superseded'/,
    );
    expect(sql).toMatch(
      /provider_request_ids = p_provider_request_ids/,
    );
  });
});
