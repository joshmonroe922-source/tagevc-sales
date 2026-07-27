/**
 * Operator-facing publish desk: channel readiness, brand matrix helpers,
 * and honest LIVE vs scaffold status for Marketing SSC.
 * Server-only (reads process.env).
 */

import { canStoreOAuthTokens } from '@/lib/shared-services/marketing-crypto';
import {
  getOAuthConfig,
  type OAuthPlatform,
} from '@/lib/shared-services/marketing-oauth';
import type {
  ChannelReadiness,
  PublisherChannelDef,
} from '@/lib/shared-services/marketing-publisher-desk-shared';

export type {
  ChannelReadiness,
  PublisherChannelDef,
} from '@/lib/shared-services/marketing-publisher-desk-shared';
export {
  PUBLISH_DESK_BRANDS,
  brandLabelForEntity,
  PLATFORM_CHAR_HINTS,
} from '@/lib/shared-services/marketing-publisher-desk-shared';

const OAUTH_ENV: Record<OAuthPlatform, string[]> = {
  linkedin: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'MARKETING_TOKEN_SECRET'],
  x: ['X_CLIENT_ID', 'X_CLIENT_SECRET', 'MARKETING_TOKEN_SECRET'],
  facebook: ['META_APP_ID', 'META_APP_SECRET', 'MARKETING_TOKEN_SECRET'],
  instagram: ['META_APP_ID', 'META_APP_SECRET', 'MARKETING_TOKEN_SECRET'],
  youtube: [
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'MARKETING_TOKEN_SECRET',
  ],
  tiktok: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'MARKETING_TOKEN_SECRET'],
};

function envMissing(keys: string[]): string[] {
  return keys.filter((key) => !process.env[key]?.trim());
}

function blogWebhookConfigured(): boolean {
  return Boolean(process.env.BLOG_PUBLISH_WEBHOOK_URL?.trim());
}

/**
 * Honest channel catalog for the connect wizard + composer empty states.
 * Call from server components / server actions only (reads process.env).
 */
export function getPublisherChannelCatalog(): PublisherChannelDef[] {
  const vaultOk = canStoreOAuthTokens();
  const vaultMissing = vaultOk ? [] : ['MARKETING_TOKEN_SECRET'];

  const social = (
    platform: OAuthPlatform,
    label: string,
    shortLabel: string,
    opts: {
      publishLiveWhenConnected: boolean;
      scaffoldReason?: string;
    },
  ): PublisherChannelDef => {
    const cfg = getOAuthConfig(platform);
    const missing = [
      ...envMissing(OAUTH_ENV[platform].filter((k) => k !== 'MARKETING_TOKEN_SECRET')),
      ...vaultMissing,
    ];
    const appConfigured = cfg.configured;
    const publishLive = appConfigured && opts.publishLiveWhenConnected;
    let readiness: ChannelReadiness = 'missing_keys';
    let readinessLabel = 'Needs API keys';
    if (appConfigured && publishLive) {
      readiness = 'live';
      readinessLabel = 'Ready for live posting';
    } else if (appConfigured && !publishLive) {
      readiness = 'scaffold';
      readinessLabel = 'Connected UI · publish still scaffold';
    } else if (!appConfigured) {
      readiness = 'missing_keys';
      readinessLabel = 'Needs API keys in Vercel env';
    }
    return {
      platform,
      label,
      shortLabel,
      kind: 'social',
      appConfigured,
      publishLive,
      readiness,
      readinessLabel,
      missingEnv: missing,
      operatorHint:
        opts.scaffoldReason ||
        (appConfigured
          ? 'Register the brand account, then Connect — you will sign in at the platform.'
          : `Set ${missing.slice(0, 3).join(', ')} in Vercel, redeploy, then Connect.`),
    };
  };

  const blogReady = blogWebhookConfigured();
  const blogMissing = blogReady
    ? []
    : ['BLOG_PUBLISH_WEBHOOK_URL', 'BLOG_PUBLISH_WEBHOOK_SECRET (optional)'];

  return [
    social('linkedin', 'LinkedIn', 'LI', {
      publishLiveWhenConnected: true,
    }),
    social('x', 'X (Twitter)', 'X', {
      publishLiveWhenConnected: true,
    }),
    social('facebook', 'Facebook', 'FB', {
      publishLiveWhenConnected: true,
      scaffoldReason:
        'Live page posts need a Page access token after Meta OAuth. User-token /me/feed is the current fallback.',
    }),
    social('instagram', 'Instagram', 'IG', {
      publishLiveWhenConnected: false,
      scaffoldReason:
        'OAuth connect is scaffolded via Meta. Graph Instagram content publishing is not LIVE yet — posts stub until Page/IG business wiring lands.',
    }),
    social('youtube', 'YouTube', 'YT', {
      publishLiveWhenConnected: false,
      scaffoldReason:
        'OAuth connect works when Google credentials are set. Upload/publish remains stub until YouTube Data API publish is enabled.',
    }),
    social('tiktok', 'TikTok', 'TT', {
      publishLiveWhenConnected:
        process.env.TIKTOK_PUBLISH_DIRECT === '1' ||
        process.env.TIKTOK_PUBLISH_DIRECT === 'true',
      scaffoldReason:
        'Connect works with TikTok Login Kit. Set TIKTOK_PUBLISH_DIRECT=1 plus a video URL (or use resumable upload) for live publish.',
    }),
    {
      platform: 'web',
      label: 'Blog / CMS',
      shortLabel: 'Blog',
      kind: 'blog',
      appConfigured: blogReady,
      publishLive: blogReady,
      readiness: blogReady ? 'live' : 'scaffold',
      readinessLabel: blogReady
        ? 'Webhook ready'
        : 'Scaffold — set blog webhook',
      missingEnv: blogMissing,
      operatorHint: blogReady
        ? 'Register a Blog account per brand (handle = site slug), Connect (marks ready), then compose with Blog selected.'
        : 'Set BLOG_PUBLISH_WEBHOOK_URL to your CMS/RSS ingest endpoint (Recruit 619, Instant NDA, Signent, or Tage site). Optional BLOG_PUBLISH_WEBHOOK_SECRET for HMAC/bearer.',
    },
  ];
}
