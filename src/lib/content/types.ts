export type SocialPlatform = 'linkedin' | 'twitter' | 'facebook' | 'instagram';

export type SocialPostStatus =
  | 'draft'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed';

export type ApprovalStatus = 'none' | 'pending' | 'approved' | 'rejected';

export type BlogStatus = 'draft' | 'scheduled' | 'published';

export type DealPathTopic = 'launch' | 'partner' | 'exit' | 'general';

export type BlogPost = {
  id: string;
  title: string;
  slug: string;
  body: string;
  excerpt: string;
  status: BlogStatus;
  deal_path: DealPathTopic | null;
  seo_title: string;
  seo_description: string;
  seo_keywords: string[];
  featured_image_url: string | null;
  author_id: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SocialPost = {
  id: string;
  content: string;
  platforms: SocialPlatform[];
  media_urls: string[];
  link_url: string | null;
  status: SocialPostStatus;
  approval_status: ApprovalStatus;
  campaign_tag: string | null;
  deal_path: DealPathTopic | null;
  blog_post_id: string | null;
  lead_id: string | null;
  author_id: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  published_urls: Record<string, string>;
  analytics: Record<string, unknown>;
  rejection_note: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type ContentActivity = {
  id: string;
  activity_type: string;
  summary: string;
  blog_post_id: string | null;
  social_post_id: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
};

export const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  linkedin: 'LinkedIn',
  twitter: 'X (Twitter)',
  facebook: 'Facebook',
  instagram: 'Instagram',
};

export const PLATFORM_LIMITS: Record<SocialPlatform, number> = {
  linkedin: 3000,
  twitter: 280,
  facebook: 63206,
  instagram: 2200,
};

export const ALL_PLATFORMS: SocialPlatform[] = [
  'linkedin',
  'twitter',
  'facebook',
  'instagram',
];

export const DEAL_PATH_LABELS: Record<DealPathTopic, string> = {
  launch: 'Launch',
  partner: 'Partner',
  exit: 'Exit',
  general: 'General',
};

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}
