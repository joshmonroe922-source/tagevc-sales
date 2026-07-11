-- Public read for published blog posts (marketing site / anon key)
-- Sales users retain full access via existing policies in 0002.

create policy "anon_read_published_blog_posts"
  on public.blog_posts
  for select
  to anon, authenticated
  using (status = 'published');
