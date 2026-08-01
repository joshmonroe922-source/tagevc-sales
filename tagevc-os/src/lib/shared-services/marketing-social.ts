/**
 * Social publishers — stub + LinkedIn / X / Meta / TikTok when OAuth tokens present.
 * Blog/CMS uses BLOG_PUBLISH_WEBHOOK_URL when configured.
 */

import { createHmac } from 'node:crypto';
import { ensureFreshAccessToken } from '@/lib/shared-services/marketing-token-refresh';
import type { MarketingPlatform } from '@/lib/shared-services/marketing-types';

export type PublishInput = {
  account_id: string;
  platform: MarketingPlatform;
  handle: string;
  title: string;
  body: string;
  media_url?: string | null;
  media_type?: 'video' | 'photo' | null;
};

export type PublishResult = {
  ok: boolean;
  publisher: string;
  external_id?: string;
  published_url?: string;
  error?: string;
  stub?: boolean;
  /** Provider accepted the job but has not confirmed publication yet. */
  processing?: boolean;
};

function isTikTokApiError(code?: string): boolean {
  return Boolean(code && code.toLowerCase() !== 'ok');
}

export interface SocialPublisher {
  readonly id: string;
  publish(input: PublishInput & { accessToken: string }): Promise<PublishResult>;
}

export class StubSocialPublisher implements SocialPublisher {
  readonly id = 'stub';

  async publish(input: PublishInput & { accessToken: string }): Promise<PublishResult> {
    const id = `stub-${Date.now().toString(36)}`;
    return {
      ok: true,
      publisher: this.id,
      external_id: id,
      published_url: `https://example.invalid/posts/${id}?handle=${encodeURIComponent(input.handle)}`,
      stub: true,
    };
  }
}

/** POST JSON to site CMS / RSS ingest when BLOG_PUBLISH_WEBHOOK_URL is set. */
export class BlogWebhookPublisher implements SocialPublisher {
  readonly id = 'blog-webhook';

  async publish(input: PublishInput & { accessToken: string }): Promise<PublishResult> {
    const url = process.env.BLOG_PUBLISH_WEBHOOK_URL?.trim();
    if (!url) {
      return {
        ok: false,
        publisher: this.id,
        error: 'BLOG_PUBLISH_WEBHOOK_URL is not configured',
      };
    }
    const payload = {
      source: 'tagevc-os-marketing',
      handle: input.handle,
      title: input.title,
      body: input.body,
      media_url: input.media_url ?? null,
      account_id: input.account_id,
      published_at: new Date().toISOString(),
    };
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'TageVC-OS-Marketing/1.0',
    };
    const secret = process.env.BLOG_PUBLISH_WEBHOOK_SECRET?.trim();
    if (secret) {
      headers.Authorization = `Bearer ${secret}`;
      headers['X-Tage-Signature'] = createHmac('sha256', secret)
        .update(body)
        .digest('hex');
    }
    try {
      const res = await fetch(url, { method: 'POST', headers, body });
      const text = await res.text();
      if (!res.ok) {
        return {
          ok: false,
          publisher: this.id,
          error: `Blog webhook HTTP ${res.status}: ${text.slice(0, 200)}`,
        };
      }
      let externalId = `blog-${Date.now().toString(36)}`;
      let publishedUrl: string | undefined;
      try {
        const json = JSON.parse(text) as {
          id?: string;
          url?: string;
          published_url?: string;
        };
        if (json.id) externalId = String(json.id);
        publishedUrl = json.published_url || json.url;
      } catch {
        /* non-JSON OK */
      }
      return {
        ok: true,
        publisher: this.id,
        external_id: externalId,
        published_url: publishedUrl ?? url,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: this.id,
        error: e instanceof Error ? e.message : 'Blog webhook failed',
      };
    }
  }
}

export class LinkedInPublisher implements SocialPublisher {
  readonly id = 'linkedin';

  async publish(
    input: PublishInput & { accessToken: string },
  ): Promise<PublishResult> {
    try {
      const meRes = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${input.accessToken}` },
      });
      const me = (await meRes.json().catch(() => ({}))) as { sub?: string };
      if (!meRes.ok || !me.sub) {
        return {
          ok: false,
          publisher: this.id,
          error: 'LinkedIn userinfo failed — reconnect OAuth',
        };
      }
      const author = `urn:li:person:${me.sub}`;
      const text = [input.title, input.body].filter(Boolean).join('\n\n').slice(0, 3000);
      const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify({
          author,
          lifecycleState: 'PUBLISHED',
          specificContent: {
            'com.linkedin.ugc.ShareContent': {
              shareCommentary: { text },
              shareMediaCategory: 'NONE',
            },
          },
          visibility: {
            'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
          },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
      };
      if (!res.ok) {
        return {
          ok: false,
          publisher: this.id,
          error: json.message || `LinkedIn HTTP ${res.status}`,
        };
      }
      return {
        ok: true,
        publisher: this.id,
        external_id: json.id,
        published_url: json.id
          ? `https://www.linkedin.com/feed/update/${json.id}`
          : undefined,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: this.id,
        error: e instanceof Error ? e.message : 'LinkedIn publish failed',
      };
    }
  }
}

export class XPublisher implements SocialPublisher {
  readonly id = 'x';

  async publish(
    input: PublishInput & { accessToken: string },
  ): Promise<PublishResult> {
    try {
      const text = [input.title, input.body]
        .filter(Boolean)
        .join('\n')
        .slice(0, 280);
      const res = await fetch('https://api.x.com/2/tweets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { id?: string };
        detail?: string;
        title?: string;
      };
      if (!res.ok) {
        return {
          ok: false,
          publisher: this.id,
          error: json.detail || json.title || `X HTTP ${res.status}`,
        };
      }
      const tweetId = json.data?.id;
      return {
        ok: true,
        publisher: this.id,
        external_id: tweetId,
        published_url: tweetId
          ? `https://x.com/${input.handle}/status/${tweetId}`
          : undefined,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: this.id,
        error: e instanceof Error ? e.message : 'X publish failed',
      };
    }
  }
}

export class MetaPublisher implements SocialPublisher {
  readonly id = 'meta';

  async publish(
    input: PublishInput & { accessToken: string },
  ): Promise<PublishResult> {
    try {
      // Page feed post — requires page token in production; use /me/feed as fallback
      const message = [input.title, input.body].filter(Boolean).join('\n\n');
      const res = await fetch(
        `https://graph.facebook.com/v19.0/me/feed?access_token=${encodeURIComponent(input.accessToken)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        id?: string;
        error?: { message?: string };
      };
      if (!res.ok) {
        return {
          ok: false,
          publisher: this.id,
          error: json.error?.message || `Meta HTTP ${res.status}`,
        };
      }
      return {
        ok: true,
        publisher: this.id,
        external_id: json.id,
        published_url: json.id
          ? `https://facebook.com/${json.id}`
          : undefined,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: this.id,
        error: e instanceof Error ? e.message : 'Meta publish failed',
      };
    }
  }
}

export class TikTokPublisher implements SocialPublisher {
  readonly id = 'tiktok';

  async publish(
    input: PublishInput & { accessToken: string },
  ): Promise<PublishResult> {
    try {
      const text = [input.title, input.body]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 2200);

      const creatorRes = await fetch(
        'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${input.accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
          },
          body: JSON.stringify({}),
        },
      );
      const creatorJson = (await creatorRes.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string };
        data?: { creator_username?: string };
      };
      if (!creatorRes.ok || isTikTokApiError(creatorJson.error?.code)) {
        return {
          ok: false,
          publisher: this.id,
          error:
            creatorJson.error?.message ||
            creatorJson.error?.code ||
            `TikTok creator_info HTTP ${creatorRes.status}`,
        };
      }

      const username =
        creatorJson.data?.creator_username || input.handle || 'tagevc';
      const imageUrl = process.env.TIKTOK_DEFAULT_IMAGE_URL?.trim();
      const videoUrl =
        input.media_url?.trim() ||
        process.env.TIKTOK_DEFAULT_VIDEO_URL?.trim();
      const direct =
        process.env.TIKTOK_PUBLISH_DIRECT === '1' ||
        process.env.TIKTOK_PUBLISH_DIRECT === 'true';

      if (direct && videoUrl) {
        const res = await fetch(
          'https://open.tiktokapis.com/v2/post/publish/video/init/',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${input.accessToken}`,
              'Content-Type': 'application/json; charset=UTF-8',
            },
            body: JSON.stringify({
              post_info: {
                title: text.slice(0, 2200),
                privacy_level: 'PUBLIC_TO_EVERYONE',
                disable_duet: false,
                disable_comment: false,
                disable_stitch: false,
              },
              source_info: {
                source: 'PULL_FROM_URL',
                video_url: videoUrl,
              },
            }),
          },
        );
        const json = (await res.json().catch(() => ({}))) as {
          data?: { publish_id?: string };
          error?: { code?: string; message?: string };
        };
        if (
          res.ok &&
          !isTikTokApiError(json.error?.code) &&
          json.data?.publish_id
        ) {
          return {
            ok: true,
            publisher: this.id,
            external_id: json.data.publish_id,
            published_url: `https://www.tiktok.com/@${username}`,
            processing: true,
          };
        }
        return {
          ok: false,
          publisher: this.id,
          error:
            json.error?.message ||
            json.error?.code ||
            `TikTok video init HTTP ${res.status}`,
        };
      }

      if (direct && imageUrl) {
        const res = await fetch(
          'https://open.tiktokapis.com/v2/post/publish/content/init/',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${input.accessToken}`,
              'Content-Type': 'application/json; charset=UTF-8',
            },
            body: JSON.stringify({
              post_info: {
                title: (input.title || text).slice(0, 90),
                description: text,
                privacy_level: 'PUBLIC_TO_EVERYONE',
                disable_duet: false,
                disable_comment: false,
                disable_stitch: false,
              },
              source_info: {
                source: 'PULL_FROM_URL',
                photo_cover_index: 0,
                photo_images: [imageUrl],
              },
              post_mode: 'DIRECT_POST',
              media_type: 'PHOTO',
            }),
          },
        );
        const json = (await res.json().catch(() => ({}))) as {
          data?: { publish_id?: string };
          error?: { code?: string; message?: string };
        };
        if (
          res.ok &&
          !isTikTokApiError(json.error?.code) &&
          json.data?.publish_id
        ) {
          return {
            ok: true,
            publisher: this.id,
            external_id: json.data.publish_id,
            published_url: `https://www.tiktok.com/@${username}`,
            processing: true,
          };
        }
        return {
          ok: false,
          publisher: this.id,
          error:
            json.error?.message ||
            json.error?.code ||
            `TikTok content init HTTP ${res.status}`,
        };
      }

      // Token validated; queue as creator-inbox pending without video bytes
      const pendingId = `tt-inbox-${Date.now().toString(36)}`;
      return {
        ok: true,
        publisher: this.id,
        external_id: pendingId,
        published_url: `https://www.tiktok.com/@${username}`,
        stub: true,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: this.id,
        error: e instanceof Error ? e.message : 'TikTok publish failed',
      };
    }
  }
}

export async function getTikTokPublishStatus(
  accountId: string,
  publishId: string,
): Promise<
  | {
      ok: true;
      processing: boolean;
      external_id?: string;
      status: string;
    }
  | { ok: false; error: string; status?: string }
> {
  const { token, refreshError } = await loadAccessToken(accountId);
  if (!token) {
    return {
      ok: false,
      error: refreshError || 'TikTok access token unavailable',
    };
  }
  try {
    const res = await fetch(
      'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({ publish_id: publishId }),
      },
    );
    const raw = await res.text();
    const json = (() => {
      try {
        return JSON.parse(raw) as {
          data?: {
            status?: string;
            fail_reason?: string;
            public_post_id?: string;
            publicly_available_post_id?: string;
            publicaly_available_post_id?: Array<string | number>;
          };
          error?: { code?: string; message?: string };
        };
      } catch {
        return {};
      }
    })();
    const exactPublicId = raw.match(
      /"publicaly_available_post_id"\s*:\s*\[\s*"?(\d+)"?/,
    )?.[1];
    const status = json.data?.status || 'UNKNOWN';
    if (
      !res.ok ||
      isTikTokApiError(json.error?.code) ||
      status === 'FAILED'
    ) {
      return {
        ok: false,
        status,
        error:
          json.data?.fail_reason ||
          json.error?.message ||
          json.error?.code ||
          `TikTok status HTTP ${res.status}`,
      };
    }
    const externalId =
      json.data?.public_post_id ||
      json.data?.publicly_available_post_id ||
      exactPublicId ||
      (json.data?.publicaly_available_post_id?.[0] != null
        ? String(json.data.publicaly_available_post_id[0])
        : undefined);
    return {
      ok: true,
      processing: status !== 'PUBLISH_COMPLETE' || !externalId,
      status:
        status === 'PUBLISH_COMPLETE' && !externalId
          ? 'PUBLISH_COMPLETE_AWAITING_PUBLIC_ID'
          : status,
      external_id: externalId,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'TikTok status failed',
    };
  }
}

async function loadAccessToken(accountId: string): Promise<{
  token: string | null;
  refreshError?: string;
}> {
  if (accountId === 'MSA-STUB') return { token: null };
  const fresh = await ensureFreshAccessToken(accountId);
  return { token: fresh.token, refreshError: fresh.error };
}

function publisherFor(platform: MarketingPlatform): SocialPublisher {
  if (platform === 'linkedin') return new LinkedInPublisher();
  if (platform === 'x') return new XPublisher();
  // Facebook Graph /me/feed is LIVE; Instagram content publishing is still scaffold.
  if (platform === 'facebook') return new MetaPublisher();
  if (platform === 'tiktok') return new TikTokPublisher();
  if (platform === 'web' && process.env.BLOG_PUBLISH_WEBHOOK_URL?.trim()) {
    return new BlogWebhookPublisher();
  }
  // instagram · youtube · web (no webhook) · other → honest stub
  return new StubSocialPublisher();
}

/**
 * Publish content for an account. Refreshes OAuth when needed;
 * stub publisher when no token (dev / unconfigured).
 * Blog/web uses webhook when configured (no OAuth token required).
 */
export async function publishForAccount(
  input: PublishInput,
): Promise<PublishResult> {
  const forceStub =
    process.env.MARKETING_FORCE_STUB_PUBLISH === '1' ||
    process.env.MARKETING_FORCE_STUB_PUBLISH === 'true';

  if (forceStub) {
    const stub = new StubSocialPublisher();
    return stub.publish({ ...input, accessToken: 'stub' });
  }

  if (input.platform === 'web' && process.env.BLOG_PUBLISH_WEBHOOK_URL?.trim()) {
    return new BlogWebhookPublisher().publish({
      ...input,
      accessToken: 'webhook',
    });
  }

  const { token } = await loadAccessToken(input.account_id);

  if (!token) {
    const allowStub =
      process.env.NODE_ENV !== 'production' ||
      process.env.VERCEL_ENV === 'preview' ||
      process.env.VERCEL_ENV === 'development';
    if (!allowStub) {
      return {
        ok: false,
        publisher: 'none',
        error:
          'No OAuth token — publish blocked in production (set MARKETING_FORCE_STUB_PUBLISH=1 only to simulate).',
      };
    }
    const stub = new StubSocialPublisher();
    return stub.publish({ ...input, accessToken: 'stub' });
  }

  const pub = publisherFor(input.platform);
  return pub.publish({ ...input, accessToken: token });
}
