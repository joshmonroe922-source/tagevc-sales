import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { generateContentDraft, slugify } from '../_shared/contentAi.ts';
import { type DealPathTopic } from '../_shared/brand.ts';
import { createServiceClient, createUserClient } from '../_shared/supabase.ts';

const TOPICS = new Set(['launch', 'partner', 'exit', 'general']);

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Unauthorized' }, 401, origin);
    }

    const userClient = createUserClient(authHeader);
    const { data: { user } } = await userClient.auth.getUser();
    if (!user?.email) return jsonResponse({ error: 'Unauthorized' }, 401, origin);

    const service = createServiceClient();
    const { data: salesUser } = await service
      .from('sales_users')
      .select('id')
      .eq('email', user.email.toLowerCase())
      .eq('active', true)
      .maybeSingle();
    if (!salesUser) return jsonResponse({ error: 'Forbidden' }, 403, origin);

    const body = await req.json() as {
      topic?: string;
      save_blog?: boolean;
      save_social?: boolean;
    };
    const topic = (body.topic ?? 'general') as DealPathTopic;
    if (!TOPICS.has(topic)) {
      return jsonResponse({ error: 'Invalid topic' }, 400, origin);
    }

    const draft = await generateContentDraft(topic);
    let blogId: string | null = null;
    let socialId: string | null = null;

    if (body.save_blog) {
      let slug = slugify(draft.blogTitle);
      const { data: existing } = await service
        .from('blog_posts')
        .select('slug')
        .like('slug', `${slug}%`);
      if (existing && existing.length > 0) {
        slug = `${slug}-${existing.length + 1}`;
      }

      const { data: blog, error } = await service
        .from('blog_posts')
        .insert({
          title: draft.blogTitle,
          slug,
          body: draft.blogBody,
          excerpt: draft.excerpt,
          status: 'draft',
          deal_path: topic === 'general' ? 'general' : topic,
          seo_title: draft.seoTitle,
          seo_description: draft.seoDescription,
          seo_keywords: draft.seoKeywords,
          author_id: salesUser.id,
        })
        .select('id')
        .single();
      if (error) throw error;
      blogId = blog.id;

      await service.from('content_activity').insert({
        activity_type: 'content_generated',
        summary: `AI blog draft: ${draft.blogTitle}`,
        blog_post_id: blogId,
        created_by: salesUser.id,
        metadata: { engine: draft.engine, topic },
      });
    }

    if (body.save_social) {
      const { data: social, error } = await service
        .from('social_posts')
        .insert({
          content: draft.socialCopy,
          platforms: ['linkedin'],
          status: 'draft',
          deal_path: topic === 'general' ? 'general' : topic,
          blog_post_id: blogId,
          author_id: salesUser.id,
          campaign_tag: `generated-${topic}`,
        })
        .select('id')
        .single();
      if (error) throw error;
      socialId = social.id;
    }

    return jsonResponse({
      ok: true,
      draft,
      blog_id: blogId,
      social_id: socialId,
    });
  } catch (err) {
    console.error(err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Unexpected error' },
      500,
      origin,
    );
  }
});
