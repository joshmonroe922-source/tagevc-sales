export type SocialPlatform = 'linkedin' | 'twitter' | 'facebook' | 'instagram';

export const PLATFORM_LIMITS: Record<SocialPlatform, number> = {
  linkedin: 3000,
  twitter: 280,
  facebook: 63206,
  instagram: 2200,
};

export type PublishResult = {
  success: boolean;
  mock: boolean;
  platform: SocialPlatform;
  postUrl?: string;
  postId?: string;
  message: string;
};

function hasOAuthConfig(platform: SocialPlatform): boolean {
  switch (platform) {
    case 'linkedin':
      return Boolean(
        Deno.env.get('LINKEDIN_CLIENT_ID') && Deno.env.get('LINKEDIN_CLIENT_SECRET'),
      );
    case 'twitter':
      return Boolean(Deno.env.get('X_CLIENT_ID') && Deno.env.get('X_CLIENT_SECRET'));
    case 'facebook':
    case 'instagram':
      return Boolean(Deno.env.get('META_APP_ID') && Deno.env.get('META_APP_SECRET'));
    default:
      return false;
  }
}

/** Mock publish when OAuth not configured — mirrors Recruiting Tools dev mode */
export async function publishToPlatform(
  platform: SocialPlatform,
  content: string,
  linkUrl?: string | null,
): Promise<PublishResult> {
  if (!hasOAuthConfig(platform)) {
    const id = crypto.randomUUID().slice(0, 8);
    return {
      success: true,
      mock: true,
      platform,
      postId: `mock-${id}`,
      postUrl: `https://mock.${platform}.tagevc.local/posts/${id}`,
      message: `Mock published to ${platform} (connect OAuth in Supabase secrets to go live).`,
    };
  }

  // Phase 2: wire real platform APIs (LinkedIn UGC, X API v2, Meta Graph)
  return {
    success: false,
    mock: false,
    platform,
    message: `${platform} OAuth configured but live publish adapter not yet implemented — use mock mode or export copy manually.`,
  };
}

export function validatePlatforms(
  platforms: SocialPlatform[],
  content: string,
): string | null {
  if (!content.trim()) return 'Content is required.';
  if (platforms.length === 0) return 'Select at least one platform.';
  for (const p of platforms) {
    if (content.length > PLATFORM_LIMITS[p]) {
      return `Content exceeds ${p} limit of ${PLATFORM_LIMITS[p]} characters.`;
    }
  }
  return null;
}

export function canAutoPublish(approvalStatus: string): boolean {
  return approvalStatus === 'none' || approvalStatus === 'approved';
}
