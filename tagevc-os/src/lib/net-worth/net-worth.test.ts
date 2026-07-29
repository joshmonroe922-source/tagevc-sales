import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import {
  BUSINESS_CREDIT_ROLES,
  canAccessInvestmentsPage,
  canAccessNetWorthPage,
  canViewBusinessCredit,
  canViewPersonalCredit,
  canViewPrivateIQuadrant,
  defaultVisibilityForClass,
  filterAssetsForFirmAum,
  isPrivateIQuadrantClass,
} from './visibility';
import {
  computeFirmAum,
  computeNetWorthBreakdown,
  parseAssetCsv,
  type InvestorAsset,
} from './assets';
import { personalCreditNextActions } from './credit';
import { MAIN_NAV } from '@/lib/nav';

function sampleAsset(
  partial: Partial<InvestorAsset> &
    Pick<InvestorAsset, 'asset_class' | 'visibility_scope' | 'balance'>,
): InvestorAsset {
  return {
    id: partial.id ?? '1',
    asset_key: partial.asset_key ?? 'k',
    name: partial.name ?? 'A',
    institution: '',
    asset_class: partial.asset_class,
    visibility_scope: partial.visibility_scope,
    entity_id: null,
    balance: partial.balance,
    currency: 'USD',
    as_of: '2026-07-25T00:00:00Z',
    last_synced_at: null,
    source: 'manual',
    external_id: null,
    connector_kind: null,
    notes: '',
  };
}

describe('phase73 visibility matrix', () => {
  it('defaults private classes to visionary_private', () => {
    expect(defaultVisibilityForClass('brokerage')).toBe('visionary_private');
    expect(defaultVisibilityForClass('crypto')).toBe('visionary_private');
    expect(defaultVisibilityForClass('retirement')).toBe('visionary_private');
    expect(defaultVisibilityForClass('business_equity')).toBe('firm_visible');
    expect(defaultVisibilityForClass('real_estate')).toBe('firm_visible');
  });

  it('blocks Net Worth / Investments / private / personal credit for non-Visionary', () => {
    expect(
      canAccessNetWorthPage({ realRole: 'partner', liveLookActive: false }),
    ).toBe(false);
    expect(
      canAccessInvestmentsPage({ realRole: 'coo', liveLookActive: false }),
    ).toBe(false);
    expect(
      canViewPrivateIQuadrant({ realRole: 'coo', liveLookActive: false }),
    ).toBe(false);
    expect(
      canViewPersonalCredit({ realRole: 'service_lead', liveLookActive: false }),
    ).toBe(false);
    expect(
      canAccessNetWorthPage({ realRole: 'visionary', liveLookActive: false }),
    ).toBe(true);
    expect(
      canAccessInvestmentsPage({ realRole: 'visionary', liveLookActive: false }),
    ).toBe(true);
  });

  it('blocks Net Worth, Investments, and personal credit during Live Look even for Visionary', () => {
    expect(
      canAccessNetWorthPage({ realRole: 'visionary', liveLookActive: true }),
    ).toBe(false);
    expect(
      canAccessInvestmentsPage({ realRole: 'visionary', liveLookActive: true }),
    ).toBe(false);
    expect(
      canViewPersonalCredit({ realRole: 'visionary', liveLookActive: true }),
    ).toBe(false);
  });

  it('allows business credit for finance/SSC roles but not Partner by default', () => {
    expect(canViewBusinessCredit('visionary')).toBe(true);
    expect(canViewBusinessCredit('service_lead')).toBe(true);
    expect(canViewBusinessCredit('coo')).toBe(true);
    expect(canViewBusinessCredit('partner')).toBe(false);
    expect(canViewBusinessCredit('associate')).toBe(false);
    expect(BUSINESS_CREDIT_ROLES).not.toContain('partner');
  });

  it('Firm AUM excludes private I-quadrant balances', () => {
    const assets = [
      sampleAsset({
        asset_class: 'crypto',
        visibility_scope: 'visionary_private',
        balance: 100000,
      }),
      sampleAsset({
        id: '2',
        asset_class: 'business_equity',
        visibility_scope: 'firm_visible',
        balance: 500000,
      }),
      sampleAsset({
        id: '3',
        asset_class: 'real_estate',
        visibility_scope: 'firm_visible',
        balance: 250000,
      }),
    ];
    const firmOnly = filterAssetsForFirmAum(assets);
    expect(firmOnly.every((a) => !isPrivateIQuadrantClass(a.asset_class))).toBe(
      true,
    );
    const aum = computeFirmAum(assets);
    expect(aum.total).toBe(750000);
    expect(aum.excludes_private_i_quadrant).toBe(true);
    expect(aum.label).toContain('operating & real estate');

    const nw = computeNetWorthBreakdown(assets);
    expect(nw.total).toBe(850000);
    expect(nw.crypto).toBe(100000);
  });
});

describe('phase73 csv + coaching', () => {
  it('parses asset CSV rows', () => {
    const rows = parseAssetCsv(
      'name,institution,asset_class,balance,currency\nBroker,Fidelity,brokerage,1000,USD\nBTC,Coinbase,crypto,2000,USD',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].asset_class).toBe('brokerage');
    expect(rows[1].balance).toBe(2000);
  });

  it('returns coaching copy without claiming legal advice', () => {
    const tips = personalCreditNextActions({
      profile: {
        id: 'p',
        owner_profile_id: 'u',
        experian_score: null,
        equifax_score: null,
        transunion_score: null,
        score_as_of: null,
        source: 'manual',
        notes: '',
      },
      items: [],
      actions: [
        {
          id: 'a',
          profile_id: 'p',
          title: 'Pull reports',
          status: 'todo',
          sort_order: 1,
          due_at: null,
          notes: '',
        },
      ],
    });
    expect(tips.some((t) => /not legal/i.test(t))).toBe(true);
  });
});

describe('phase73 nav + sql + api surfaces', () => {
  it('exposes Assets children with Investments + Net Worth Visionary-only', () => {
    const assets = MAIN_NAV.find((n) => n.label === 'Assets');
    expect(assets?.children?.map((c) => c.label)).toEqual([
      'Net Worth',
      'Businesses',
      'Real Estate',
      'Investments',
    ]);
    const inv = assets?.children?.find(
      (c) => c.href === '/portfolio/investments',
    );
    const nw = assets?.children?.find((c) => c.href === '/portfolio/net-worth');
    expect(inv?.visionaryOnly).toBe(true);
    expect(inv?.hideDuringLiveLook).toBe(true);
    expect(nw?.visionaryOnly).toBe(true);
    expect(nw?.hideDuringLiveLook).toBe(true);
    expect(nw?.description).not.toMatch(/credit/i);
  });

  it('places Credit Management under Personal as Visionary-exclusive', () => {
    const personal = MAIN_NAV.find((n) => n.label === 'Personal');
    expect(personal?.visionaryExclusive).toBe(true);
    expect(personal?.hiddenForRoles).toContain('think_tank');
    expect(personal?.children?.map((c) => c.label)).toEqual([
      'Personal Finance',
      'Credit Management',
    ]);
    const credit = personal?.children?.find((c) => c.label === 'Credit Management');
    expect(credit?.href).toBe('/personal/credit');
    expect(credit?.visionaryExclusive).toBe(true);
    expect(credit?.visionaryOnly).toBe(true);
    expect(credit?.hideDuringLiveLook).toBe(true);
    expect(credit?.hiddenForRoles).toContain('think_tank');
  });

  it('hides Command Center, Firm, and BD for COO role in nav config', () => {
    const commandCenter = MAIN_NAV.find((n) => n.label === 'Command Center');
    const firm = MAIN_NAV.find((n) => n.label === 'Firm');
    const bd = MAIN_NAV.find((n) => n.label === 'Business Development');
    expect(commandCenter?.hiddenForRoles).toContain('coo');
    expect(firm?.hiddenForRoles).toContain('coo');
    expect(bd?.hiddenForRoles).toContain('coo');
  });

  it('ships SQL migration and permission API routes', () => {
    const sql = resolve(process.cwd(), 'supabase/phase73_net_worth_credit.sql');
    expect(existsSync(sql)).toBe(true);
    const body = readFileSync(sql, 'utf8');
    expect(body).toContain('os_investor_assets');
    expect(body).toContain('visionary_private');
    expect(body).toContain('os_personal_credit_profiles');
    expect(body).toContain('is_visionary_role');
    expect(
      existsSync(
        resolve(process.cwd(), 'src/app/api/net-worth/private/route.ts'),
      ),
    ).toBe(true);
    expect(
      existsSync(
        resolve(
          process.cwd(),
          'src/app/api/net-worth/personal-credit/route.ts',
        ),
      ),
    ).toBe(true);
  });
});
