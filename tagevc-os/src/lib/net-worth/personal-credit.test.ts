import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import {
  buildCreditAdvisorSystemPrompt,
} from './credit-grok';
import { FICO_REVIEW_STARTER } from './credit-grok-constants';
import {
  extractTextFromPdfBuffer,
  isStale,
  parseCreditReportText,
  primaryFico10,
  primaryFico8,
} from './credit-parse';
import {
  canViewPersonalCredit,
  canAccessNetWorthPage,
} from './visibility';

const MYFICO_SAMPLE = `
myFICO Advanced Monitoring Report
Report Date: 07/20/2026
FICO Score 8: 785
FICO Score 10: 778
FICO Auto 8: 790
FICO Bankcard 8: 782
Equifax FICO Score 8: 780
Experian FICO Score 8: 785
TransUnion FICO Score 8: 788
Credit Utilization: 18%
Hard Inquiries: 2 in the last 12 months
Collections: 0
Negative items: 0
Open accounts: 11
`;

const EXPERIAN_SAMPLE = `
Experian IdentityWorks Premium
As of: 2026-07-18
Experian FICO Score 8: 772
Experian FICO Score 10: 765
FICO Auto Score 8: 770
Bankcard Score 8: 768
Utilization: 22%
Inquiries last 12 months: 1
`;

describe('phase74 fico parser', () => {
  it('extracts FICO 8/10/Auto/Bankcard from myFICO-style text', () => {
    const parsed = parseCreditReportText({
      text: MYFICO_SAMPLE,
      preferredSource: 'myfico',
    });
    expect(parsed.source_guess).toBe('myfico');
    expect(parsed.scores.fico_8).toBe(785);
    expect(parsed.scores.fico_10).toBe(778);
    expect(parsed.scores.fico_auto_8).toBe(790);
    expect(parsed.scores.fico_bankcard_8).toBe(782);
    expect(primaryFico8(parsed.scores)).toBe(785);
    expect(primaryFico10(parsed.scores)).toBe(778);
    expect(parsed.summary.utilization_pct).toBe(18);
    expect(parsed.parse_status).toBe('parsed');
  });

  it('extracts Experian-style FICO 8/10', () => {
    const parsed = parseCreditReportText({
      text: EXPERIAN_SAMPLE,
      preferredSource: 'experian',
    });
    expect(parsed.source_guess).toBe('experian');
    expect(parsed.scores.fico_8).toBe(772);
    expect(parsed.scores.fico_10).toBe(765);
    expect(parsed.bureau === 'experian' || parsed.bureau === 'tri_merge').toBe(
      true,
    );
  });

  it('fail-soft when no scores', () => {
    const parsed = parseCreditReportText({ text: 'hello world' });
    expect(parsed.parse_status).toBe('failed');
    expect(parsed.parse_errors.length).toBeGreaterThan(0);
  });

  it('harvests strings from minimal PDF-like buffer', () => {
    const fake = Buffer.from(
      '%PDF-1.4\nBT (FICO Score 8: 740) Tj ET\n(FICO Score 10: 735) Tj',
      'latin1',
    );
    const text = extractTextFromPdfBuffer(fake);
    const parsed = parseCreditReportText({ text });
    expect(parsed.scores.fico_8).toBe(740);
    expect(parsed.scores.fico_10).toBe(735);
  });

  it('detects stale past threshold', () => {
    const old = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString();
    expect(isStale(old, 45)).toBe(true);
    expect(isStale(new Date().toISOString(), 45)).toBe(false);
  });
});

describe('phase74 permissions + grok bias', () => {
  it('blocks personal credit for non-Visionary and Live Look', () => {
    expect(
      canViewPersonalCredit({ realRole: 'partner', liveLookActive: false }),
    ).toBe(false);
    expect(
      canViewPersonalCredit({ realRole: 'visionary', liveLookActive: true }),
    ).toBe(false);
    expect(
      canAccessNetWorthPage({ realRole: 'visionary', liveLookActive: false }),
    ).toBe(true);
  });

  it('Grok system prompt emphasizes FICO 8 and 10', () => {
    const prompt = buildCreditAdvisorSystemPrompt('CONTEXT');
    expect(prompt).toMatch(/FICO Score 8/);
    expect(prompt).toMatch(/FICO Score 10/);
    expect(prompt).toMatch(/Educational only/);
    expect(prompt).toContain('CONTEXT');
    expect(FICO_REVIEW_STARTER).toMatch(/FICO 8 and FICO 10/);
  });

  it('ships phase74 SQL with subjects and credit-private bucket', () => {
    const sql = resolve(
      process.cwd(),
      'supabase/phase74_personal_credit_dual.sql',
    );
    expect(existsSync(sql)).toBe(true);
    const body = readFileSync(sql, 'utf8');
    expect(body).toContain('josh_monroe');
    expect(body).toContain('lauren_monroe');
    expect(body).toContain('os_personal_credit_snapshots');
    expect(body).toContain('scores jsonb');
    expect(body).toContain('credit-private');
    expect(body).toContain('is_visionary_role');
    expect(body).toContain('os_personal_credit_grok_messages');
  });
});
