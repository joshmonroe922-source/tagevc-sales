-- Tage VC Content & Social (Hootsuite-style) — mirrors Recruiting Tools patterns
-- Blog CMS for SEO + multi-platform social scheduling

-- ---------------------------------------------------------------------------
-- blog_posts
-- ---------------------------------------------------------------------------
create table if not exists public.blog_posts (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  slug              text not null unique,
  body              text not null default '',
  excerpt           text not null default '',
  status            text not null default 'draft'
                      check (status in ('draft', 'scheduled', 'published')),
  deal_path         text
                      check (deal_path is null or deal_path in ('launch', 'partner', 'exit', 'general')),
  seo_title         text not null default '',
  seo_description   text not null default '',
  seo_keywords      text[] not null default '{}',
  featured_image_url text,
  author_id         uuid references public.sales_users (id) on delete set null,
  scheduled_at      timestamptz,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists blog_posts_status_idx on public.blog_posts (status);
create index if not exists blog_posts_scheduled_idx on public.blog_posts (scheduled_at);
create index if not exists blog_posts_deal_path_idx on public.blog_posts (deal_path);
create index if not exists blog_posts_published_idx on public.blog_posts (published_at desc);

alter table public.blog_posts enable row level security;

-- ---------------------------------------------------------------------------
-- social_posts (canonical multi-platform)
-- ---------------------------------------------------------------------------
create table if not exists public.social_posts (
  id                uuid primary key default gen_random_uuid(),
  content           text not null,
  platforms         text[] not null default '{}',
  media_urls        text[] not null default '{}',
  link_url          text,
  status            text not null default 'draft'
                      check (status in ('draft', 'scheduled', 'publishing', 'published', 'failed')),
  approval_status   text not null default 'none'
                      check (approval_status in ('none', 'pending', 'approved', 'rejected')),
  campaign_tag      text,
  deal_path         text
                      check (deal_path is null or deal_path in ('launch', 'partner', 'exit', 'general')),
  blog_post_id      uuid references public.blog_posts (id) on delete set null,
  lead_id           uuid references public.sales_leads (id) on delete set null,
  author_id         uuid references public.sales_users (id) on delete set null,
  scheduled_at      timestamptz,
  published_at      timestamptz,
  published_urls    jsonb not null default '{}'::jsonb,
  analytics         jsonb not null default '{}'::jsonb,
  rejection_note    text,
  error_message     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists social_posts_status_idx on public.social_posts (status);
create index if not exists social_posts_scheduled_idx on public.social_posts (scheduled_at);
create index if not exists social_posts_approval_idx on public.social_posts (approval_status);
create index if not exists social_posts_campaign_idx on public.social_posts (campaign_tag);

alter table public.social_posts enable row level security;

-- ---------------------------------------------------------------------------
-- integration_tokens (OAuth — LinkedIn, X, Meta, etc.)
-- ---------------------------------------------------------------------------
create table if not exists public.integration_tokens (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null unique
                  check (provider in ('linkedin', 'twitter', 'facebook', 'instagram', 'canva')),
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.integration_tokens enable row level security;

-- ---------------------------------------------------------------------------
-- content_activity log
-- ---------------------------------------------------------------------------
create table if not exists public.content_activity (
  id            uuid primary key default gen_random_uuid(),
  activity_type text not null
                  check (activity_type in (
                    'blog_created', 'blog_updated', 'blog_published',
                    'social_created', 'social_scheduled', 'social_published', 'social_failed',
                    'content_generated', 'integration_connected'
                  )),
  summary       text not null default '',
  blog_post_id  uuid references public.blog_posts (id) on delete set null,
  social_post_id uuid references public.social_posts (id) on delete set null,
  metadata      jsonb not null default '{}'::jsonb,
  created_by    uuid references public.sales_users (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists content_activity_created_idx
  on public.content_activity (created_at desc);

alter table public.content_activity enable row level security;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create or replace function public.set_content_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists blog_posts_updated_at on public.blog_posts;
create trigger blog_posts_updated_at
  before update on public.blog_posts
  for each row execute function public.set_content_updated_at();

drop trigger if exists social_posts_updated_at on public.social_posts;
create trigger social_posts_updated_at
  before update on public.social_posts
  for each row execute function public.set_content_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
create policy "Sales users view blog posts"
  on public.blog_posts for select using (public.is_active_sales_user());

create policy "Sales users manage blog posts"
  on public.blog_posts for all
  using (public.is_active_sales_user())
  with check (public.is_active_sales_user());

create policy "Sales users view social posts"
  on public.social_posts for select using (public.is_active_sales_user());

create policy "Sales users manage social posts"
  on public.social_posts for all
  using (public.is_active_sales_user())
  with check (public.is_active_sales_user());

create policy "Sales users view integration tokens"
  on public.integration_tokens for select
  using (public.is_active_sales_user() and public.sales_user_role() in ('admin', 'manager'));

create policy "Admins manage integration tokens"
  on public.integration_tokens for all
  using (public.is_active_sales_user() and public.sales_user_role() = 'admin')
  with check (public.is_active_sales_user() and public.sales_user_role() = 'admin');

create policy "Sales users view content activity"
  on public.content_activity for select using (public.is_active_sales_user());

create policy "Sales users insert content activity"
  on public.content_activity for insert
  with check (public.is_active_sales_user());

-- ---------------------------------------------------------------------------
-- Seed SEO blog posts (published — ready for public website sync)
-- ---------------------------------------------------------------------------
insert into public.blog_posts (
  title, slug, excerpt, body, status, deal_path,
  seo_title, seo_description, seo_keywords, published_at
) values
(
  'What Is a Venture Studio? How Tage VC Helps Founders Launch Faster',
  'what-is-a-venture-studio-tage-vc-launch',
  'Venture studios compress time-to-market by pairing capital with operators. Learn how Tage VC supports founders on the Launch path.',
  E'## Why founders choose a venture studio\n\nStarting a company from zero means juggling product, fundraising, hiring, legal, and go-to-market — often before you have a full team. A **venture studio** (sometimes called a company builder) partners with founders early, providing operational leverage alongside capital.\n\n**Tage Venture Capital** works with founders on the **Launch** path: validating the idea, shaping the product, standing up infrastructure, and building the first repeatable sales motion.\n\n## What Tage VC brings to Launch\n\n1. **Operator bench** — GTM, product, and ops support without hiring a full executive team on day one.\n2. **Capital alignment** — Investment structured around milestones, not vanity metrics.\n3. **Shared playbooks** — Lessons from portfolio companies applied to your market entry.\n4. **Speed to first customers** — Website, intake, and outbound systems wired from the start.\n\n## Is Launch right for you?\n\nLaunch is best when you have domain insight, a clear problem, and appetite to build — but need partners who have done it before. If you are pre-product or pre-revenue with a strong thesis, this path is worth a conversation.\n\n## Next step\n\nTell us about your idea through our website form. We review every inbound lead and respond within two business days.',
  'published',
  'launch',
  'What Is a Venture Studio? | Tage VC Launch Path',
  'How Tage Venture Capital helps founders launch faster with studio-style operator support, capital, and GTM playbooks.',
  array['venture studio', 'launch', 'founder', 'tage vc', 'startup'],
  now() - interval '3 days'
),
(
  'Strategic Partnerships for Growth-Stage Companies',
  'strategic-partnerships-growth-stage-tage-vc',
  'The Partner path at Tage VC connects growth-stage companies with distribution, technology, and capital partners.',
  E'## Beyond fundraising: the Partner path\n\nNot every conversation with Tage Venture Capital is about starting something new. Many leaders come to us on the **Partner** path — when they have traction, a team, and a gap that a strategic relationship could fill.\n\nPartnerships might include:\n\n- **Distribution** — Access to customers or channels you cannot reach alone.\n- **Technology** — Integrations, data, or platform capabilities that accelerate roadmap.\n- **Capital** — Structured investment tied to partnership outcomes, not just valuation.\n\n## How we evaluate Partner opportunities\n\nWe look for mutual leverage: your product or service should strengthen our portfolio or thesis, and our network should materially change your growth curve.\n\nSignals we like:\n\n- Recurring revenue or strong unit economics\n- Clear ICP and reference customers\n- A partnership hypothesis you can test in 90 days\n\n## Working with Tage VC on Partner\n\nOur sales team tracks Partner leads separately from Launch and Exit. Expect diligence on fit, economics, and integration effort before term discussions.\n\n## Get in touch\n\nUse the Partner option on our contact form so we route your inquiry correctly.',
  'published',
  'partner',
  'Strategic Partnerships for Growth-Stage Companies | Tage VC',
  'How Tage Venture Capital partners with growth-stage companies on distribution, technology, and capital-aligned deals.',
  array['strategic partnership', 'growth stage', 'tage vc', 'b2b'],
  now() - interval '2 days'
),
(
  'Planning a Business Exit: When Founders Should Start the Conversation',
  'planning-business-exit-when-founders-start',
  'Exits reward preparation. Here is when to begin exit planning and how Tage VC supports founders on the Exit path.',
  E'## Exit is a process, not an event\n\nThe best exits are years in the making. Founders who wait until burnout or a single inbound offer are leaving money and optionality on the table.\n\n**Tage Venture Capital** supports the **Exit** path for owners and leadership teams who want a thoughtful transition — whether that is a strategic sale, private equity partnership, or structured liquidity event.\n\n## When to start\n\nConsider opening an Exit conversation when:\n\n- Revenue is predictable and the business runs without daily founder heroics\n- You have 18–36 months of runway to optimize valuation drivers\n- You know your "why" for selling — lifestyle, next venture, or legacy\n\n## What we help with\n\n- **Narrative and positioning** — How buyers will categorize and value your business\n- **Diligence readiness** — Data room, contracts, customer concentration, team retention\n- **Buyer mapping** — Strategic, financial, and hybrid paths\n- **Timeline discipline** — Parallel option creation instead of single-buyer dependency\n\n## Confidentiality\n\nExit inquiries are handled discreetly. Use our website form and select the Exit path — we do not broadcast inbound interest.\n\n## Start early\n\nEven if you are not selling this year, a short call can clarify what to improve now for a stronger outcome later.',
  'published',
  'exit',
  'Planning a Business Exit: When to Start | Tage VC',
  'When founders should begin exit planning and how Tage Venture Capital supports confidential Exit path conversations.',
  array['business exit', 'founder exit', 'sell company', 'tage vc'],
  now() - interval '1 day'
),
(
  'Launch vs. Partner vs. Exit: Choosing Your Path with Tage Venture Capital',
  'launch-partner-exit-choosing-your-path',
  'Tage VC routes every inbound conversation to Launch, Partner, or Exit. Here is how to pick the right path.',
  E'## Three doors into Tage VC\n\nEvery lead we receive is tagged with a **deal path**. That is not bureaucracy — it ensures you talk to the right playbook from the first call.\n\n### Launch\n\n**Best for:** Pre-revenue or early-revenue founders building a new venture.\n\n**You get:** Studio-style support, capital, GTM and ops leverage.\n\n**Signals:** New product, new market entry, need for co-builders.\n\n### Partner\n\n**Best for:** Growth-stage companies with product-market fit seeking strategic leverage.\n\n**You get:** Distribution, technology partnerships, structured investment.\n\n**Signals:** Repeatable sales, partnership thesis, integration opportunity.\n\n### Exit\n\n**Best for:** Owners considering liquidity in the next 1–3 years.\n\n**You get:** Confidential guidance on positioning, diligence, and buyer options.\n\n**Signals:** Stable operations, succession planning, inbound or proactive sale interest.\n\n## Not sure?\n\nSelect the closest fit on our form and explain your situation in notes. We reroute quickly if needed — the goal is momentum, not paperwork.\n\n## One intake, three playbooks\n\nOur website and CRM are wired so your submission creates a lead, alerts our team, and starts the right nurture sequence automatically.',
  'published',
  'general',
  'Launch vs Partner vs Exit | Tage Venture Capital',
  'How to choose the Launch, Partner, or Exit path when contacting Tage Venture Capital.',
  array['tage vc', 'launch', 'partner', 'exit', 'venture capital'],
  now()
),
(
  'How Inbound SEO Drives Qualified Leads for Venture and Operating Companies',
  'inbound-seo-qualified-leads-venture',
  'SEO and content are the top of funnel for Tage VC. Here is how we think about content, search, and conversion.',
  E'## SEO as infrastructure, not marketing fluff\n\nFor Tage Venture Capital, **search and content are the primary lead channel**. Founders and operators research options long before they fill out a form. If we are not visible in that moment, we lose deals we never knew existed.\n\n## Our content principles\n\n1. **Path-specific pages** — Launch, Partner, and Exit content answers different questions. We do not mash them into one generic "contact us."\n2. **Depth over volume** — A smaller set of authoritative posts beats thin blogs no one reads.\n3. **Internal linking** — Every article routes to a clear CTA and the right intake form.\n4. **Sales + marketing alignment** — Blog and social content is managed in the same portal that runs pipeline and drips.\n\n## From click to conversation\n\nWhen someone submits our form:\n\n- A lead is created in **New**\n- Josh gets an email alert\n- A drip sequence starts (thank-you, follow-up task, nurture reminder)\n- Social posts can be scheduled to amplify the same themes\n\n## What we publish\n\nThought leadership on venture studios, partnerships, and exits — plus practical guides for founders evaluating their next step.\n\n## Explore our paths\n\n- **Launch** — Building something new\n- **Partner** — Scaling with strategic leverage\n- **Exit** — Planning a transition\n\nReady to talk? Choose your path on tagevc.com.',
  'published',
  'general',
  'Inbound SEO for Venture Firms | Tage VC',
  'How Tage Venture Capital uses SEO and content marketing to drive qualified Launch, Partner, and Exit inbound leads.',
  array['seo', 'inbound marketing', 'venture capital', 'content marketing', 'tage vc'],
  now()
)
on conflict (slug) do nothing;

-- Seed companion social drafts promoting blog content
do $$
declare
  v_blog uuid;
  v_author uuid;
begin
  select id into v_author from public.sales_users where email = 'josh@tagevc.com' limit 1;

  select id into v_blog from public.blog_posts
  where slug = 'what-is-a-venture-studio-tage-vc-launch' limit 1;

  if v_blog is not null then
    insert into public.social_posts (
      content, platforms, status, deal_path, blog_post_id, author_id, campaign_tag
    ) values (
      'Building from zero? A venture studio pairs capital with operators who have shipped before. Tage VC''s Launch path is for founders with a clear thesis and appetite to move fast. Read more → tagevc.com/blog/what-is-a-venture-studio-tage-vc-launch #VentureStudio #Founders #TageVC',
      array['linkedin', 'twitter'],
      'draft',
      'launch',
      v_blog,
      v_author,
      'blog-launch-studio'
    ) on conflict do nothing;
  end if;
end $$;
