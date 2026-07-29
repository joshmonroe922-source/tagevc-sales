import { describe, expect, it } from 'vitest';
import {
  canManageIesConnections,
  canRefreshIesSnapshots,
  iesConnectHref,
  iesOpenInBooksHref,
  IES_EMBED_POLICY,
} from './ux';

describe('IES UX helpers', () => {
  it('gates Connect to write:shared_services roles', () => {
    expect(canManageIesConnections('visionary')).toBe(true);
    expect(canManageIesConnections('ssc_finance')).toBe(true);
    expect(canManageIesConnections('partner')).toBe(false);
    expect(canManageIesConnections('sub_lead')).toBe(false);
  });

  it('allows Refresh for P&L readers and shared-services readers', () => {
    expect(canRefreshIesSnapshots('visionary')).toBe(true);
    expect(canRefreshIesSnapshots('partner')).toBe(true);
    expect(canRefreshIesSnapshots('sub_lead')).toBe(true);
    expect(canRefreshIesSnapshots('coo')).toBe(true);
    expect(canRefreshIesSnapshots('ssc_finance')).toBe(true);
    expect(canRefreshIesSnapshots('associate')).toBe(false);
  });

  it('builds entity-scoped Connect OAuth href', () => {
    expect(iesConnectHref('ENT-INDA')).toBe(
      '/api/finance/ies/oauth?entity=ENT-INDA',
    );
    expect(iesConnectHref(null)).toBe('/api/finance/ies/oauth');
  });

  it('builds Open in IES P&L deep link from locked company map', () => {
    expect(iesOpenInBooksHref('ENT-R619')).toContain(
      '9341457251406251',
    );
    expect(iesOpenInBooksHref('ENT-R619')).toContain('ProfitAndLoss');
    expect(iesOpenInBooksHref(null)).toContain('homepage');
  });

  it('documents embed policy', () => {
    expect(IES_EMBED_POLICY).toMatch(/iframe embed/i);
  });
});
