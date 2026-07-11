import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import {
  canAutoPublish,
  publishToPlatform,
  type SocialPlatform,
} from '../_shared/socialPublish.ts';
import { createServiceClient, createUserClient } from '../_shared/supabase.ts';

type ProcessResult = {
  social_processed: number;
  social_published: number;
  social_failed: number;
  blogs_published: number;
  errors: string[];
};

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin);
  }

  try {
    const cronSecret = Deno.env.get('CONTENT_CRON_SECRET');
    const headerSecret = req.headers.get('x-content-secret');
    const authHeader = req.headers.get('Authorization');
    let authorized = false;

    if (cronSecret && headerSecret && headerSecret === cronSecret) {
      authorized = true;
    } else if (authHeader?.startsWith('Bearer ')) {
      const userClient = createUserClient(authHeader);
      const { data: { user } } = await userClient.auth.getUser();
      if (user?.email) {
        const service = createServiceClient();
        const { data: su } = await service
          .from('sales_users')
          .select('role, active')
          .eq('email', user.email.toLowerCase())
          .eq('active', true)
          .maybeSingle();
        if (su) authorized = true;
      }
    }

    if (!authorized) {
      return jsonResponse({ error: 'Unauthorized' }, 401, origin);
    }

    const service = createServiceClient();
    const result: ProcessResult = {
      social_processed: 0,
      social_published: 0,
      social_failed: 0,
      blogs_published: 0,
      errors: [],
    };
    const now = new Date().toISOString();

    // Publish due social posts
    const { data: dueSocial } = await service
      .from('social_posts')
      .select('*')
      .eq('status', 'scheduled')
      .lte('scheduled_at', now)
      .in('approval_status', ['none', 'approved'])
      .order('scheduled_at', { ascending: true })
      .limit(50);

    for (const post of dueSocial ?? []) {
      result.social_processed++;
      if (!canAutoPublish(post.approval_status)) continue;

      await service
        .from('social_posts')
        .update({ status: 'publishing' })
        .eq('id', post.id);

      const publishedUrls: Record<string, string> = {};
      const platforms = (post.platforms ?? []) as SocialPlatform[];
      let anySuccess = false;
      const errors: string[] = [];

      for (const platform of platforms) {
        const pub = await publishToPlatform(platform, post.content, post.link_url);
        if (pub.success && pub.postUrl) {
          publishedUrls[platform] = pub.postUrl;
          anySuccess = true;
        } else {
          errors.push(`${platform}: ${pub.message}`);
        }
      }

      await service
        .from('social_posts')
        .update({
          status: anySuccess ? 'published' : 'failed',
          published_at: anySuccess ? now : post.published_at,
          published_urls: publishedUrls,
          error_message: errors.join('; ') || null,
        })
        .eq('id', post.id);

      await service.from('content_activity').insert({
        activity_type: anySuccess ? 'social_published' : 'social_failed',
        summary: anySuccess
          ? `Published to ${platforms.join(', ')}`
          : `Failed: ${errors.join('; ')}`,
        social_post_id: post.id,
        created_by: post.author_id,
        metadata: { mock: true, published_urls: publishedUrls },
      });

      if (anySuccess) result.social_published++;
      else {
        result.social_failed++;
        result.errors.push(...errors);
      }
    }

    // Flip scheduled blogs to published
    const { data: dueBlogs } = await service
      .from('blog_posts')
      .select('id, title')
      .eq('status', 'scheduled')
      .lte('scheduled_at', now)
      .limit(50);

    for (const blog of dueBlogs ?? []) {
      await service
        .from('blog_posts')
        .update({ status: 'published', published_at: now })
        .eq('id', blog.id);
      await service.from('content_activity').insert({
        activity_type: 'blog_published',
        summary: `Blog published: ${blog.title}`,
        blog_post_id: blog.id,
      });
      result.blogs_published++;
    }

    return jsonResponse({ ok: true, ...result });
  } catch (err) {
    console.error(err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Unexpected error' },
      500,
      origin,
    );
  }
});
