import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  newPlatformEmailTrackingToken,
  sendGraphMail,
} from '@/lib/platform/email/graph-send';

describe('platform email graph-send', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('newPlatformEmailTrackingToken returns 32 hex chars', () => {
    const t = newPlatformEmailTrackingToken();
    expect(t).toMatch(/^[0-9a-f]{32}$/);
  });

  it('sendGraphMail posts to Graph sendMail', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    await sendGraphMail({
      accessToken: 'tok',
      subject: 'Hello',
      bodyHtml: '<p>Hi</p>',
      to: ['a@example.com'],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.microsoft.com/v1.0/me/sendMail');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body)) as {
      message: { toRecipients: Array<{ emailAddress: { address: string } }> };
      saveToSentItems: boolean;
    };
    expect(body.message.toRecipients[0]?.emailAddress.address).toBe(
      'a@example.com',
    );
    expect(body.saveToSentItems).toBe(true);
  });

  it('sendGraphMail rejects empty recipients', async () => {
    await expect(
      sendGraphMail({
        accessToken: 'tok',
        subject: 'x',
        bodyHtml: '<p>x</p>',
        to: [],
      }),
    ).rejects.toThrow(/To recipient/i);
  });
});
