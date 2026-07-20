/**
 * Social publishers — stub + LinkedIn / X when OAuth tokens present (Phase 23).
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { decryptSecret } from '@/lib/shared-services/marketing-crypto';
import type { MarketingPlatform } from '@/lib/shared-services/marketing-types';

export type PublishInput = {
  account_id: string;
  platform: MarketingPlatform;
  handle: string;
  title: string;
  body: string;
};

export type PublishResult = {
  ok: boolean;
  publisher: string;
  external_id?: string;
  published_url?: string;
  error?: string;
  stub?: boolean;
};

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

async function loadAccessToken(accountId: string): Promise<string | null> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_marketing_oauth_tokens')
      .select('access_token_cipher')
      .eq('account_id', accountId)
      .maybeSingle();
    if (error || !data) return null;
    return decryptSecret(String(data.access_token_cipher));
  } catch {
    return null;
  }
}

function publisherFor(platform: MarketingPlatform): SocialPublisher {
  if (platform === 'linkedin') return new LinkedInPublisher();
  if (platform === 'x') return new XPublisher();
  return new StubSocialPublisher();
}

/**
 * Publish content for an account. Uses live API when token decrypts;
 * otherwise stub publisher (still succeeds for soak/dev).
 */
export async function publishForAccount(
  input: PublishInput,
): Promise<PublishResult> {
  const token = await loadAccessToken(input.account_id);
  const forceStub =
    process.env.MARKETING_FORCE_STUB_PUBLISH === '1' ||
    process.env.MARKETING_FORCE_STUB_PUBLISH === 'true';

  if (!token || forceStub) {
    const stub = new StubSocialPublisher();
    return stub.publish({ ...input, accessToken: 'stub' });
  }

  const pub = publisherFor(input.platform);
  if (pub.id === 'stub') {
    return pub.publish({ ...input, accessToken: token });
  }
  return pub.publish({ ...input, accessToken: token });
}
