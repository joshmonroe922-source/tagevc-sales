# SEO blog seed — sync to public website at /blog/{slug}

These five posts are also inserted by `supabase/migrations/0002_content_social.sql`.
Edit in the sales portal under **Content → Blog**, or use the markdown files in this folder.

| File | Path | Topic |
|------|------|-------|
| `what-is-a-venture-studio-tage-vc-launch.md` | Launch | Venture studio explainer |
| `strategic-partnerships-growth-stage-tage-vc.md` | Partner | Partnership path |
| `planning-business-exit-when-founders-start.md` | Exit | Exit planning |
| `launch-partner-exit-choosing-your-path.md` | General | Path selector guide |
| `inbound-seo-qualified-leads-venture.md` | General | SEO + intake strategy |

## Website integration (Next.js)

1. Run `0003_blog_public_read.sql` so anon can `SELECT` published posts.
2. Fetch from Supabase, falling back to these markdown files when offline / unset env:

```ts
const { data } = await supabase
  .from('blog_posts')
  .select('title, slug, body, excerpt, seo_title, seo_description, published_at')
  .eq('slug', slug)
  .eq('status', 'published')
  .single();
```

Published posts in the sales portal appear on `tagevc-website` at `/blog/{slug}` after the public RLS policy is applied.

## Social promotion

Each published blog can have companion social drafts in **Content → Social**. Use campaign tags like `blog-launch-studio` to group posts. Submit drafts to the **Approvals** tab before they enter the publish queue.
