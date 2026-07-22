import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  REVENUE_AUTHENTICITY_MODES,
  REVENUE_REPORT_VERSION_PHASE41,
  sha256,
  verifyRevenueAuthenticity,
} from './marketing-revenue-contracts';
import { emptyPhase41RevenueReport } from './marketing-phase41';

function signJwt(claims: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${header}.${payload}`, 'utf8')
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

describe('Phase 41 production ledger revenue contracts', () => {
  it('exposes fail-closed authenticity modes beyond hmac and request_id', () => {
    expect(REVENUE_AUTHENTICITY_MODES).toEqual([
      'hmac_sha256',
      'request_id',
      'signed_headers_v1',
      'jwt_bearer_v1',
    ]);
    expect(
      verifyRevenueAuthenticity({
        mode: 'signed_headers_v1',
        rawBody: '{"request_id":"r1"}',
        requestId: 'r1',
        signature: null,
        signatureSecret: 'secret',
        contentSha256Header: sha256('{"request_id":"r1"}'),
      }).ok,
    ).toBe(false);
    expect(
      verifyRevenueAuthenticity({
        mode: 'jwt_bearer_v1',
        rawBody: '{"request_id":"r1"}',
        requestId: 'r1',
        signature: null,
        signatureSecret: 'secret',
        sourceJwt: null,
      }).ok,
    ).toBe(false);
  });

  it('verifies signed_headers_v1 against request id and body digest', () => {
    const body = JSON.stringify({ request_id: 'request-41' });
    const bodySha = sha256(body);
    const signature = createHmac('sha256', 'ledger-secret')
      .update(`request-41\n${bodySha}`, 'utf8')
      .digest('hex');
    const ok = verifyRevenueAuthenticity({
      mode: 'signed_headers_v1',
      rawBody: body,
      requestId: 'request-41',
      signature: `sha256=${signature}`,
      signatureSecret: 'ledger-secret',
      contentSha256Header: bodySha,
    });
    expect(ok.ok).toBe(true);
    expect(ok.evidence.header_digest_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(
      verifyRevenueAuthenticity({
        mode: 'signed_headers_v1',
        rawBody: body,
        requestId: 'request-41',
        signature: `sha256=${signature}`,
        signatureSecret: 'ledger-secret',
        contentSha256Header: sha256('tampered'),
      }).ok,
    ).toBe(false);
  });

  it('verifies jwt_bearer_v1 and rejects expired or mismatched claims', () => {
    const body = JSON.stringify({ request_id: 'jwt-1' });
    const bodySha = sha256(body);
    const token = signJwt(
      {
        request_id: 'jwt-1',
        body_sha256: bodySha,
        exp: Math.floor(Date.now() / 1000) + 600,
      },
      'jwt-secret',
    );
    const verified = verifyRevenueAuthenticity({
      mode: 'jwt_bearer_v1',
      rawBody: body,
      requestId: 'jwt-1',
      signature: null,
      signatureSecret: 'jwt-secret',
      sourceJwt: token,
    });
    expect(verified.ok).toBe(true);
    expect(verified.evidence.claims_digest_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(verified.evidence.metadata).not.toHaveProperty('signature');
    expect(verified.evidence.metadata).not.toHaveProperty('jwt');

    const expired = signJwt(
      {
        request_id: 'jwt-1',
        body_sha256: bodySha,
        exp: Math.floor(Date.now() / 1000) - 10,
      },
      'jwt-secret',
    );
    expect(
      verifyRevenueAuthenticity({
        mode: 'jwt_bearer_v1',
        rawBody: body,
        requestId: 'jwt-1',
        signature: null,
        signatureSecret: 'jwt-secret',
        sourceJwt: expired,
      }).ok,
    ).toBe(false);
  });

  it('shapes the phase41 report contract and empty helper', () => {
    const empty = emptyPhase41RevenueReport();
    expect(empty.version).toBe(REVENUE_REPORT_VERSION_PHASE41);
    expect(empty.authenticity_modes).toEqual([]);
    expect(empty.pending_correction_queue).toEqual([]);
    expect(empty.settlement_lag.available).toBe(false);
  });

  it('enforces phase41 SQL authenticity expansion, probes, and settlement lag', () => {
    const sql = readFileSync(
      new URL(
        '../../../supabase/phase41_marketing_production_ledgers.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sql).toMatch(/public\.os_sha256_hex/);
    expect(sql).toMatch(/search_path = public, extensions/);
    expect(sql).toMatch(/signed_headers_v1/);
    expect(sql).toMatch(/jwt_bearer_v1/);
    expect(sql).toMatch(/ledger_profile in \('production_v1','sandbox_v1'\)/);
    expect(sql).toMatch(/ledger_kind in \('ad_platform','production_ledger'\)/);
    expect(sql).toMatch(/os_marketing_revenue_authenticity_probes/);
    expect(sql).toMatch(/Authenticity probe rows are immutable/);
    expect(sql).toMatch(/get_marketing_revenue_phase41_report/);
    expect(sql).toMatch(/get_marketing_revenue_settlement_lag_phase41/);
    expect(sql).toMatch(/os_marketing_paid_revenue_evidence/);
    expect(sql).toMatch(/to_regclass\('public\.os_marketing_paid_revenue_evidence'\)/);
    expect(sql).toMatch(
      /grant execute on function public\.get_marketing_revenue_phase41_report\(text,integer\)\s+to authenticated, service_role/,
    );
    expect(sql).not.toMatch(/os_store_snapshots/);
    expect(sql).not.toMatch(
      /if\s+case\s+when/i,
    );
  });

  it('wires phase41 report and correction review into marketing surfaces', () => {
    const page = readFileSync(
      new URL(
        '../../app/(app)/shared-services/marketing/page.tsx',
        import.meta.url,
      ),
      'utf8',
    );
    const actions = readFileSync(
      new URL(
        '../../app/(app)/shared-services/marketing/actions.ts',
        import.meta.url,
      ),
      'utf8',
    );
    const route = readFileSync(
      new URL(
        '../../app/api/marketing/revenue-ingestion-worker/route.ts',
        import.meta.url,
      ),
      'utf8',
    );
    expect(page).toMatch(/MarketingRevenuePhase41/);
    expect(page).toMatch(/getPhase41RevenueReport/);
    expect(page).toMatch(/Phase 4[1-8]/);
    expect(actions).toMatch(/reviewMarketingRevenueCorrectionAction/);
    expect(actions).toMatch(/upsertMarketingRevenueSourceAction/);
    expect(actions).toMatch(/visionary.*admin|admin.*visionary/);
    expect(route).toMatch(/phase4[3-8]-v1/);
  });
});
