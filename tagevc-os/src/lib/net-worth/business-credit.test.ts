import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import {
  guessBusinessBureau,
  parseBusinessCreditReportText,
} from './business-credit-parse';
import {
  bureauCardStatus,
  primaryBureauIdentifier,
  primaryBusinessScore,
  type BusinessBureauSnapshot,
} from './business-credit-types';
import { businessBureauStaleAlerts, orderCompanies } from './business-credit-bureaus';
import { canViewBusinessCredit, canViewPersonalCredit } from './visibility';
import { isStale } from './credit-parse';

const DNB_SAMPLE = `
Dun & Bradstreet Business Credit Report
Report Date: 07/15/2026
D-U-N-S Number: 12-345-6789
PAYDEX Score: 80
Delinquency Predictor Score: 460
Failure Score: 1520
Trade Experiences: 14
Public Records: 0
Inquiries: 3
Payment performance: Pays promptly
`;

const EXPERIAN_BIZ_SAMPLE = `
Experian Business Credit Report
Generated on: 2026-07-10
Business File Number: BX7745120
Intelliscore Plus: 65
Financial Stability Risk Score: 22
Tradelines: 9
Public Records: 1
Judgment filed 2024
`;

const EQUIFAX_BIZ_SAMPLE = `
Equifax Business Credit Report
As of: 07/12/2026
Equifax Business ID: EQ-99231
Business Credit Risk Score: 420
Business Failure Score: 1310
Payment Index: 88
Inquiries: 2
`;

describe('phase75 business bureau parser', () => {
  it('extracts D&B PAYDEX + DUNS', () => {
    const p = parseBusinessCreditReportText({ text: DNB_SAMPLE });
    expect(p.bureau).toBe('dnb');
    expect(p.identifiers.duns).toBe('123456789');
    expect(p.scores.paydex).toBe(80);
    expect(p.scores.failure_score).toBe(1520);
    expect(p.summary.tradelines_count).toBe(14);
    expect(p.report_date).toBe('2026-07-15');
    expect(p.parse_status).toBe('parsed');
  });

  it('extracts Experian Business Intelliscore + file number', () => {
    const p = parseBusinessCreditReportText({
      text: EXPERIAN_BIZ_SAMPLE,
      preferredBureau: 'experian_business',
    });
    expect(p.scores.intelliscore_plus).toBe(65);
    expect(p.scores.financial_stability_risk).toBe(22);
    expect(p.identifiers.experian_file_number).toBe('BX7745120');
    expect(p.summary.public_records).toBe(1);
    expect(p.summary.risk_flags).toContain('judgment_mentioned');
  });

  it('extracts Equifax Business risk + failure scores', () => {
    const p = parseBusinessCreditReportText({
      text: EQUIFAX_BIZ_SAMPLE,
      preferredBureau: 'equifax_business',
    });
    expect(p.scores.business_credit_risk).toBe(420);
    expect(p.scores.business_failure_score).toBe(1310);
    expect(p.scores.payment_index).toBe(88);
    expect(p.identifiers.equifax_id).toBe('EQ-99231');
  });

  it('guesses bureau from text', () => {
    expect(guessBusinessBureau(DNB_SAMPLE)).toBe('dnb');
    expect(guessBusinessBureau(EXPERIAN_BIZ_SAMPLE)).toBe('experian_business');
    expect(guessBusinessBureau(EQUIFAX_BIZ_SAMPLE)).toBe('equifax_business');
  });

  it('fail-soft with no scores — no fake values', () => {
    const p = parseBusinessCreditReportText({ text: 'hello world' });
    expect(p.parse_status).toBe('failed');
    expect(Object.values(p.scores).every((v) => v == null)).toBe(true);
    expect(p.parse_errors.length).toBeGreaterThan(0);
  });
});

function fakeSnapshot(
  over: Partial<BusinessBureauSnapshot>,
): BusinessBureauSnapshot {
  return {
    id: 's1',
    entity_id: 'ENT-FIRM',
    bureau: 'dnb',
    pulled_at: new Date().toISOString(),
    report_date: null,
    source: 'guided_export',
    identifiers: {},
    scores: {},
    summary: {},
    raw_storage_path: null,
    parse_status: 'parsed',
    parse_errors: '',
    days_old: 0,
    stale: false,
    ...over,
  };
}

describe('phase75 cards + stale detection', () => {
  it('primary score/identifier per bureau', () => {
    expect(primaryBusinessScore('dnb', { paydex: 80 }).value).toBe(80);
    expect(
      primaryBusinessScore('experian_business', { intelliscore_plus: 65 }).label,
    ).toBe('Intelliscore Plus');
    expect(
      primaryBusinessScore('equifax_business', { business_credit_risk: 420 })
        .value,
    ).toBe(420);
    expect(primaryBureauIdentifier('dnb', { duns: '123456789' }).value).toBe(
      '123456789',
    );
  });

  it('card status: healthy / attention / no_data', () => {
    expect(bureauCardStatus(null)).toBe('no_data');
    expect(bureauCardStatus(fakeSnapshot({}))).toBe('healthy');
    expect(bureauCardStatus(fakeSnapshot({ stale: true }))).toBe('attention');
    expect(
      bureauCardStatus(fakeSnapshot({ summary: { public_records: 2 } })),
    ).toBe('attention');
  });

  it('stale alerts fire per company × bureau', () => {
    const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const alerts = businessBureauStaleAlerts([
      {
        entity_id: 'ENT-FIRM',
        company_name: 'Tage Venture Capital',
        connections: [],
        byBureau: {
          dnb: fakeSnapshot({ pulled_at: old, days_old: 90, stale: true }),
          experian_business: fakeSnapshot({}),
          equifax_business: null,
        },
      },
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toMatch(/Dun & Bradstreet/);
    expect(isStale(old, 60)).toBe(true);
  });

  it('orders Tage first then A–Z', () => {
    const ordered = orderCompanies([
      { entity_id: 'ENT-SIGNENT' },
      { entity_id: 'ENT-INDA' },
      { entity_id: 'ENT-FIRM' },
      { entity_id: 'ENT-R619' },
    ]);
    expect(ordered.map((o) => o.entity_id)).toEqual([
      'ENT-FIRM',
      'ENT-INDA', // Instant NDA
      'ENT-R619', // Recruit 619
      'ENT-SIGNENT', // Signent
    ]);
  });
});

describe('phase75 permissions + SQL', () => {
  it('business credit roles unchanged from Phase 73', () => {
    expect(canViewBusinessCredit('visionary')).toBe(true);
    expect(canViewBusinessCredit('coo')).toBe(true);
    expect(canViewBusinessCredit('service_lead')).toBe(true);
    expect(canViewBusinessCredit('counsel_ops')).toBe(true);
    expect(canViewBusinessCredit('admin')).toBe(true);
    expect(canViewBusinessCredit('partner')).toBe(false);
    expect(canViewBusinessCredit('associate')).toBe(false);
  });

  it('personal credit stays Visionary-only + Live Look blocked (regression)', () => {
    expect(
      canViewPersonalCredit({ realRole: 'coo', liveLookActive: false }),
    ).toBe(false);
    expect(
      canViewPersonalCredit({ realRole: 'visionary', liveLookActive: true }),
    ).toBe(false);
  });

  it('ships phase75 SQL: three bureaus, RLS, no drops', () => {
    const sql = resolve(
      process.cwd(),
      'supabase/phase75_business_credit_bureaus.sql',
    );
    expect(existsSync(sql)).toBe(true);
    const body = readFileSync(sql, 'utf8');
    expect(body).toContain('os_business_credit_snapshots');
    expect(body).toContain('os_business_credit_connections');
    expect(body).toContain("'dnb'");
    expect(body).toContain("'experian_business'");
    expect(body).toContain("'equifax_business'");
    expect(body).toContain('can_view_business_credit');
    expect(body).toContain('identifiers jsonb');
    expect(body).toContain('scores jsonb');
    expect(body).not.toMatch(/drop\s+table/i);
    expect(body).not.toMatch(/(alter|drop|truncate)[^;]*os_store_snapshots/i);
  });
});
