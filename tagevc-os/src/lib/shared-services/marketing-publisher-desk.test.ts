import { describe, expect, it } from 'vitest';
import {
  PLATFORM_CHAR_HINTS,
  PUBLISH_DESK_BRANDS,
  brandLabelForEntity,
} from '@/lib/shared-services/marketing-publisher-desk-shared';

describe('marketing publisher desk shared', () => {
  it('lists priority brands with display names', () => {
    expect(PUBLISH_DESK_BRANDS.map((b) => b.label)).toEqual([
      'Tage Venture Capital',
      'Recruit 619',
      'Signent HR',
      'Instant NDA',
    ]);
  });

  it('labels firm-wide when entity is null', () => {
    expect(brandLabelForEntity(null)).toBe('Firm-wide / Tage');
    expect(brandLabelForEntity('ENT-R619')).toBe('Recruit 619');
  });

  it('exposes character hints for compose UI', () => {
    expect(PLATFORM_CHAR_HINTS.x).toBe(280);
    expect(PLATFORM_CHAR_HINTS.linkedin).toBeGreaterThan(280);
    expect(PLATFORM_CHAR_HINTS.web).toBeGreaterThan(1000);
  });
});

describe('marketing social publisher routing honesty', () => {
  it('documents Instagram as stub-routed (not Meta /me/feed)', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(
        new URL('./marketing-social.ts', import.meta.url),
        'utf8',
      ),
    );
    expect(src).toMatch(/Facebook Graph \/me\/feed is LIVE/);
    expect(src).toMatch(/Instagram content publishing is still scaffold/);
    expect(src).not.toMatch(
      /platform === 'facebook' \|\| platform === 'instagram'/,
    );
  });
});
