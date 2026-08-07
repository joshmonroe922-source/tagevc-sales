import { describe, expect, it } from 'vitest';
import {
  assertBrandLogoCoverage,
  brandLogoEntities,
  getEntityLogo,
  listEntityLogoAssets,
} from '@/lib/entities/logo';

describe('getEntityLogo', () => {
  it('resolves primary + icon for all four brand entities', () => {
    const coverage = assertBrandLogoCoverage();
    expect(coverage.ok).toBe(true);
    expect(coverage.missing).toEqual([]);
    expect(brandLogoEntities()).toEqual([
      'ENT-FIRM',
      'ENT-R619',
      'ENT-SIGNENT',
      'ENT-INDA',
    ]);
  });

  it('returns public marketing-sot URLs and local paths', () => {
    const primary = getEntityLogo('ENT-FIRM', 'primary');
    expect(primary?.publicUrl).toContain(
      '/brand-assets/marketing-sot/ENT-FIRM/tagevc-logo-gold-blue-on-white-rectangle.png',
    );
    expect(primary?.localPublicPath).toBe(
      '/brand/ENT-FIRM/tagevc-logo-gold-blue-on-white-rectangle.png',
    );
    expect(primary?.alt).toBe('Tage Venture Capital logo');
  });

  it('uses Instant NDA badge for icon role', () => {
    const icon = getEntityLogo('ENT-INDA', 'icon');
    expect(icon?.variant).toBe('badge');
    expect(icon?.filename).toBe('instantnda-badge.png');
  });

  it('picks dark-surface variants when available', () => {
    const firmDark = getEntityLogo('ENT-FIRM', 'primary', { surface: 'dark' });
    expect(firmDark?.variant).toBe('gold-white-on-navy');
    const r619Dark = getEntityLogo('ENT-R619', 'primary', { surface: 'dark' });
    expect(r619Dark?.variant).toBe('gold-on-navy');
  });

  it('normalizes legacy Instant NDA alias', () => {
    expect(getEntityLogo('ENT-002', 'primary')?.entityId).toBe('ENT-INDA');
  });

  it('lists catalog assets without inventing files', () => {
    expect(listEntityLogoAssets('ENT-SIGNENT')).toHaveLength(3);
    expect(listEntityLogoAssets('ENT-UNKNOWN')).toEqual([]);
    expect(getEntityLogo(null)).toBeNull();
  });
});
