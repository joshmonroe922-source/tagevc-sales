import { describe, expect, it } from 'vitest';
import {
  base64UrlDecode,
  injectMailTracking,
  openTrackingUrl,
} from '@/lib/platform/email/mail-tracking';
import { summarizePlatformEmailMessages } from '@/lib/platform/email/types';

describe('platform email mail-tracking', () => {
  it('injects open pixel and wraps links', () => {
    const html =
      '<html><body><p>Hi <a href="https://example.com/x">link</a></p></body></html>';
    const out = injectMailTracking(
      html,
      'tok123',
      'https://app.example.com/api/mail-tracking',
    );
    expect(out).toContain('action=open&t=tok123');
    expect(out).toContain('action=click&t=tok123');
    expect(out).toContain('width="1" height="1"');
    expect(base64UrlDecode(out.match(/&u=([^&"]+)/)?.[1] ?? '')).toContain(
      'https://example.com/x',
    );
  });

  it('builds open URL', () => {
    expect(openTrackingUrl('abc', 'https://x.test/api/mail-tracking')).toBe(
      'https://x.test/api/mail-tracking?action=open&t=abc',
    );
  });

  it('summarizes analytics', () => {
    const s = summarizePlatformEmailMessages([
      { status: 'delivered', open_count: 2, click_count: 1 },
      { status: 'sent', open_count: 0, click_count: 0 },
      { status: 'bounced', open_count: 0, click_count: 0 },
    ]);
    expect(s.sent).toBe(3);
    expect(s.opened).toBe(1);
    expect(s.clicked).toBe(1);
    expect(s.bounced).toBe(1);
  });
});
