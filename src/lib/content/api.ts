import { requireSupabase, supabase } from '../supabase';
import type {
  BlogPost,
  ContentActivity,
  DealPathTopic,
  SocialPlatform,
  SocialPost,
} from './types';
import { slugify } from './types';

export async function listBlogPosts(status?: string): Promise<BlogPost[]> {
  let q = requireSupabase()
    .from('blog_posts')
    .select('*')
    .order('updated_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as BlogPost[];
}

export async function getBlogPost(id: string): Promise<BlogPost | null> {
  const { data, error } = await requireSupabase()
    .from('blog_posts')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as BlogPost | null;
}

export async function createBlogPost(input: {
  title: string;
  body: string;
  excerpt?: string;
  deal_path?: DealPathTopic | null;
  seo_title?: string;
  seo_description?: string;
  seo_keywords?: string[];
  author_id: string;
  status?: string;
  scheduled_at?: string | null;
}): Promise<BlogPost> {
  const client = requireSupabase();
  let slug = slugify(input.title);
  const { data: dupes } = await client.from('blog_posts').select('slug').like('slug', `${slug}%`);
  if (dupes && dupes.length > 0) slug = `${slug}-${dupes.length + 1}`;

  const { data, error } = await client
    .from('blog_posts')
    .insert({
      title: input.title.trim(),
      slug,
      body: input.body,
      excerpt: input.excerpt ?? input.body.slice(0, 160),
      deal_path: input.deal_path ?? 'general',
      seo_title: input.seo_title ?? input.title,
      seo_description: input.seo_description ?? '',
      seo_keywords: input.seo_keywords ?? [],
      author_id: input.author_id,
      status: input.status ?? 'draft',
      scheduled_at: input.scheduled_at ?? null,
      published_at: input.status === 'published' ? new Date().toISOString() : null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as BlogPost;
}

export async function updateBlogPost(
  id: string,
  patch: Partial<BlogPost>,
): Promise<BlogPost> {
  const { id: _id, created_at: _c, updated_at: _u, ...rest } = patch as BlogPost;
  const { data, error } = await requireSupabase()
    .from('blog_posts')
    .update(rest)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as BlogPost;
}

export async function deleteBlogPost(id: string): Promise<void> {
  const { error } = await requireSupabase().from('blog_posts').delete().eq('id', id);
  if (error) throw error;
}

export async function listSocialPosts(opts?: {
  status?: string;
  approval_status?: string;
}): Promise<SocialPost[]> {
  let q = requireSupabase()
    .from('social_posts')
    .select('*')
    .order('updated_at', { ascending: false });
  if (opts?.status) q = q.eq('status', opts.status);
  if (opts?.approval_status) q = q.eq('approval_status', opts.approval_status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as SocialPost[];
}

export async function createSocialPost(input: {
  content: string;
  platforms: SocialPlatform[];
  author_id: string;
  status?: string;
  scheduled_at?: string | null;
  link_url?: string | null;
  media_urls?: string[];
  campaign_tag?: string | null;
  deal_path?: DealPathTopic | null;
  blog_post_id?: string | null;
  approval_status?: string;
}): Promise<SocialPost> {
  const { data, error } = await requireSupabase()
    .from('social_posts')
    .insert({
      content: input.content.trim(),
      platforms: input.platforms,
      author_id: input.author_id,
      status: input.status ?? 'draft',
      scheduled_at: input.scheduled_at ?? null,
      link_url: input.link_url ?? null,
      media_urls: input.media_urls ?? [],
      campaign_tag: input.campaign_tag ?? null,
      deal_path: input.deal_path ?? null,
      blog_post_id: input.blog_post_id ?? null,
      approval_status: input.approval_status ?? 'none',
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as SocialPost;
}

export async function updateSocialPost(
  id: string,
  patch: Partial<SocialPost>,
): Promise<SocialPost> {
  const { id: _id, created_at: _c, updated_at: _u, ...rest } = patch as SocialPost;
  const { data, error } = await requireSupabase()
    .from('social_posts')
    .update(rest)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as SocialPost;
}

export async function deleteSocialPost(id: string): Promise<void> {
  const { error } = await requireSupabase().from('social_posts').delete().eq('id', id);
  if (error) throw error;
}

export async function listContentActivity(limit = 30): Promise<ContentActivity[]> {
  const { data, error } = await requireSupabase()
    .from('content_activity')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ContentActivity[];
}

export async function generateContent(opts: {
  topic: DealPathTopic;
  save_blog?: boolean;
  save_social?: boolean;
}): Promise<{
  draft: Record<string, unknown>;
  blog_id: string | null;
  social_id: string | null;
}> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-content`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(opts),
    },
  );
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? 'Generate failed');
  return body;
}

export async function processScheduledContent(): Promise<Record<string, unknown>> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-scheduled-content`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
    },
  );
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? 'Process failed');
  return body;
}

export async function getContentStats() {
  const client = requireSupabase();
  const [blogs, social, pending] = await Promise.all([
    client.from('blog_posts').select('id', { count: 'exact', head: true }),
    client.from('social_posts').select('id', { count: 'exact', head: true }),
    client
      .from('social_posts')
      .select('id', { count: 'exact', head: true })
      .eq('approval_status', 'pending'),
  ]);
  const scheduled = await client
    .from('social_posts')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'scheduled');
  const publishedBlogs = await client
    .from('blog_posts')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published');

  return {
    totalBlogs: blogs.count ?? 0,
    publishedBlogs: publishedBlogs.count ?? 0,
    totalSocial: social.count ?? 0,
    scheduledSocial: scheduled.count ?? 0,
    pendingApproval: pending.count ?? 0,
  };
}
