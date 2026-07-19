-- Marketing plan & audit matrix (parent + subsidiaries)
-- Source: docs/marketing/Marketing Plan and Audit.docx
-- Run after 0027 on project hqmobgtnedmhzipusert (Finance may own 0027)

-- ---------------------------------------------------------------------------
-- Templates (catalog) — used for seed + auto-provision on new ops_entities
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_control_templates (
  control_key          text primary key,
  title                text not null,
  description          text not null default '',
  area                 text not null default 'General',
  document_kind        text not null default 'RECORDS'
                         check (document_kind in ('POLICY', 'RECORDS')),
  evidence_expectation text not null default '',
  source               text not null default 'audit'
                         check (source in ('audit', 'recommended', 'manual')),
  cadence              text not null default 'annual'
                         check (cadence in ('annual', 'monthly', 'quarterly', 'one_time', 'custom')),
  owner_role           text not null default 'Marketing',
  applies_to_parent    boolean not null default true,
  applies_to_entities  boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create or replace function public.set_marketing_control_templates_updated_at()
returns trigger language plpgsql as $mkt$
begin
  new.updated_at = now();
  return new;
end;
$mkt$;

drop trigger if exists marketing_control_templates_updated_at on public.marketing_control_templates;
create trigger marketing_control_templates_updated_at
  before update on public.marketing_control_templates
  for each row execute function public.set_marketing_control_templates_updated_at();

-- ---------------------------------------------------------------------------
-- Controls (matrix rows): entity_id null = parent company
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_controls (
  id                   uuid primary key default gen_random_uuid(),
  entity_id            uuid references public.ops_entities (id) on delete cascade,
  control_key          text not null default '',
  title                text not null,
  description          text not null default '',
  area                 text not null default 'General',
  document_kind        text not null default 'RECORDS'
                         check (document_kind in ('POLICY', 'RECORDS')),
  evidence_expectation text not null default '',
  source               text not null default 'manual'
                         check (source in ('audit', 'recommended', 'manual')),
  applies_to_parent    boolean not null default true,
  applies_to_entities  boolean not null default true,
  cadence              text not null default 'annual'
                         check (cadence in ('annual', 'monthly', 'quarterly', 'one_time', 'custom')),
  owner_role           text not null default 'Marketing',
  next_due_at          date,
  last_reviewed_at     date,
  status               text not null default 'open'
                         check (status in ('open', 'in_progress', 'compliant', 'gap', 'na')),
  evidence_url         text not null default '',
  evidence_notes       text not null default '',
  notes                text not null default '',
  active               boolean not null default true,
  created_by           uuid references public.sales_users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists marketing_controls_key_scope_uidx
  on public.marketing_controls (control_key, coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where control_key <> '' and active = true;

create index if not exists marketing_controls_area_idx
  on public.marketing_controls (area)
  where active = true;

create index if not exists marketing_controls_status_idx
  on public.marketing_controls (status)
  where active = true;

create index if not exists marketing_controls_entity_idx
  on public.marketing_controls (entity_id)
  where active = true;

create or replace function public.set_marketing_controls_updated_at()
returns trigger language plpgsql as $mkt$
begin
  new.updated_at = now();
  return new;
end;
$mkt$;

drop trigger if exists marketing_controls_updated_at on public.marketing_controls;
create trigger marketing_controls_updated_at
  before update on public.marketing_controls
  for each row execute function public.set_marketing_controls_updated_at();

alter table public.marketing_controls enable row level security;

drop policy if exists "Marketing users manage marketing controls" on public.marketing_controls;
create policy "Marketing users manage marketing controls"
  on public.marketing_controls for all
  using (public.is_active_sales_user() and public.user_has_portal('marketing'))
  with check (public.is_active_sales_user() and public.user_has_portal('marketing'));

alter table public.marketing_control_templates enable row level security;

drop policy if exists "Marketing users read marketing templates" on public.marketing_control_templates;
create policy "Marketing users read marketing templates"
  on public.marketing_control_templates for select
  using (public.is_active_sales_user() and public.user_has_portal('marketing'));

-- ---------------------------------------------------------------------------
-- Marketing tasks linked to incomplete controls (optionally mirror to sales_tasks)
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_tasks (
  id            uuid primary key default gen_random_uuid(),
  control_id    uuid not null references public.marketing_controls (id) on delete cascade,
  sales_task_id uuid references public.sales_tasks (id) on delete set null,
  title         text not null,
  status        text not null default 'open'
                  check (status in ('open', 'done', 'cancelled')),
  assigned_to   uuid references public.sales_users (id) on delete set null,
  due_at        date,
  notes         text not null default '',
  created_by    uuid references public.sales_users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists marketing_tasks_open_control_uidx
  on public.marketing_tasks (control_id)
  where status = 'open';

create index if not exists marketing_tasks_status_idx
  on public.marketing_tasks (status, due_at);

create or replace function public.set_marketing_tasks_updated_at()
returns trigger language plpgsql as $mkt$
begin
  new.updated_at = now();
  return new;
end;
$mkt$;

drop trigger if exists marketing_tasks_updated_at on public.marketing_tasks;
create trigger marketing_tasks_updated_at
  before update on public.marketing_tasks
  for each row execute function public.set_marketing_tasks_updated_at();

alter table public.marketing_tasks enable row level security;

drop policy if exists "Marketing users manage marketing tasks" on public.marketing_tasks;
create policy "Marketing users manage marketing tasks"
  on public.marketing_tasks for all
  using (public.is_active_sales_user() and public.user_has_portal('marketing'))
  with check (public.is_active_sales_user() and public.user_has_portal('marketing'));

-- ---------------------------------------------------------------------------
-- Provision helpers
-- ---------------------------------------------------------------------------
create or replace function public.provision_marketing_controls_for_entity(p_entity_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $mkt$
declare
  inserted integer := 0;
begin
  insert into public.marketing_controls (
    entity_id, control_key, title, description, area, document_kind,
    evidence_expectation, source, cadence, owner_role,
    applies_to_parent, applies_to_entities, status, notes
  )
  select
    p_entity_id,
    t.control_key,
    t.title,
    t.description,
    t.area,
    t.document_kind,
    t.evidence_expectation,
    t.source,
    t.cadence,
    t.owner_role,
    t.applies_to_parent,
    t.applies_to_entities,
    'open',
    'Auto-provisioned for new entity from marketing control templates'
  from public.marketing_control_templates t
  where t.applies_to_entities = true
    and not exists (
      select 1 from public.marketing_controls c
      where c.control_key = t.control_key
        and c.entity_id = p_entity_id
        and c.active = true
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$mkt$;

create or replace function public.provision_marketing_controls_for_parent()
returns integer
language plpgsql
security definer
set search_path = public
as $mkt$
declare
  inserted integer := 0;
begin
  insert into public.marketing_controls (
    entity_id, control_key, title, description, area, document_kind,
    evidence_expectation, source, cadence, owner_role,
    applies_to_parent, applies_to_entities, status, notes
  )
  select
    null,
    t.control_key,
    t.title,
    t.description,
    t.area,
    t.document_kind,
    t.evidence_expectation,
    t.source,
    t.cadence,
    t.owner_role,
    t.applies_to_parent,
    t.applies_to_entities,
    'open',
    'Seeded from Marketing Plan and Audit'
  from public.marketing_control_templates t
  where t.applies_to_parent = true
    and not exists (
      select 1 from public.marketing_controls c
      where c.control_key = t.control_key
        and c.entity_id is null
        and c.active = true
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$mkt$;

create or replace function public.trg_ops_entities_provision_marketing()
returns trigger
language plpgsql
security definer
set search_path = public
as $mkt$
begin
  if new.status in ('active', 'forming', 'acquired') then
    perform public.provision_marketing_controls_for_entity(new.id);
  end if;
  return new;
end;
$mkt$;

drop trigger if exists ops_entities_provision_marketing on public.ops_entities;
create trigger ops_entities_provision_marketing
  after insert on public.ops_entities
  for each row execute function public.trg_ops_entities_provision_marketing();

create or replace function public.trg_ops_entities_provision_marketing_on_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $mkt$
begin
  if new.status is distinct from old.status
     and new.status in ('active', 'forming', 'acquired')
     and (old.status is null or old.status not in ('active', 'forming', 'acquired')) then
    perform public.provision_marketing_controls_for_entity(new.id);
  end if;
  return new;
end;
$mkt$;

drop trigger if exists ops_entities_provision_marketing_on_status on public.ops_entities;
create trigger ops_entities_provision_marketing_on_status
  after update of status on public.ops_entities
  for each row execute function public.trg_ops_entities_provision_marketing_on_status();

create or replace function public.create_marketing_tasks_for_incomplete(p_created_by uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $mkt$
declare
  inserted integer := 0;
begin
  insert into public.marketing_tasks (control_id, title, status, due_at, notes, created_by)
  select
    c.id,
    'Marketing: ' || c.title,
    'open',
    c.next_due_at,
    coalesce(nullif(c.area, ''), 'Marketing') || ' · ' || coalesce(nullif(c.control_key, ''), 'control'),
    p_created_by
  from public.marketing_controls c
  where c.active = true
    and c.status in ('open', 'in_progress', 'gap')
    and not exists (
      select 1 from public.marketing_tasks t
      where t.control_id = c.id and t.status = 'open'
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$mkt$;

grant execute on function public.provision_marketing_controls_for_entity(uuid) to authenticated;
grant execute on function public.provision_marketing_controls_for_parent() to authenticated;
grant execute on function public.create_marketing_tasks_for_incomplete(uuid) to authenticated;

update public.sales_portals
set description = 'Marketing plan & audit across parent + subsidiaries, plus blog/social content ops.'
where slug = 'marketing';

insert into public.marketing_control_templates (control_key, title, description, area, document_kind, evidence_expectation, source, cadence, owner_role, applies_to_parent, applies_to_entities) values
('strat-entity-goals','Entity marketing goals & KPIs','Define entity-specific goals (brand awareness, lead gen, CAC, market share) aligned to business objectives.','Strategy & Objectives','RECORDS','Documented goals + KPI targets','audit','annual','Marketing',true,true),
('strat-entity-plan','Entity marketing plan','Develop/maintain entity-specific marketing plan aligned with overall business objectives.','Strategy & Objectives','RECORDS','Current entity marketing plan','audit','annual','Marketing',true,true),
('strat-entity-swot','Market research / competitor / SWOT','Conduct entity-level market research, competitor analysis, and SWOT.','Strategy & Objectives','RECORDS','Research / SWOT pack','audit','annual','Marketing',true,true),
('strat-group-vision','Group marketing strategy & vision','Establish overarching group marketing strategy (portfolio synergy, cross-sell, group brand equity).','Strategy & Objectives','POLICY','Group marketing strategy doc','audit','annual','Marketing',true,false),
('strat-group-goals','Consolidated group marketing goals','Set consolidated goals (group leads, brand sentiment, CLV across entities).','Strategy & Objectives','RECORDS','Group goals dashboard / memo','audit','annual','Marketing',true,false),
('strat-entity-alignment','Entity plans aligned to group priorities','Align entity plans to group priorities while allowing local flexibility.','Strategy & Objectives','RECORDS','Alignment review notes','audit','annual','Marketing',true,true),
('strat-annual-group-review','Annual group strategy review','Annual group marketing strategy review with input from subsidiary leaders.','Strategy & Objectives','RECORDS','Review minutes / deck','audit','annual','Marketing',true,false),
('brand-entity-messaging','Entity messaging & positioning','Adapt core messaging/positioning to subsidiary products, audience, and local market.','Branding & Positioning','RECORDS','Entity messaging brief','audit','annual','Marketing',true,true),
('brand-visual-identity','Entity visual identity consistency','Maintain required consistent visual identity elements at entity level.','Branding & Positioning','RECORDS','Brand compliance checklist / samples','audit','annual','Marketing',true,true),
('brand-group-guidelines','Group Brand Guidelines','Create/maintain Group Brand Guidelines (master + sub-brands): logo, tone, visual standards, messaging hierarchy.','Branding & Positioning','POLICY','Published brand guidelines','audit','annual','Marketing',true,false),
('brand-architecture','Brand architecture decision','Document brand architecture (monolithic / endorsed / standalone sub-brands).','Branding & Positioning','POLICY','Architecture decision record','audit','annual','Marketing',true,false),
('brand-touchpoint-consistency','Touchpoint consistency with localization','Ensure consistency across touchpoints while allowing localized adaptations.','Branding & Positioning','RECORDS','Touchpoint audit samples','audit','annual','Marketing',true,true),
('brand-dam','Digital asset management (DAM)','Manage brand assets in shared DAM accessible to all entities.','Branding & Positioning','RECORDS','DAM access list + inventory','audit','annual','Marketing',true,false),
('chan-entity-digital','Entity digital channels (SEO/SEM/social/email/web)','Execute digital: SEO/SEM, social, email, content, website/landing pages tailored to entity.','Channels & Campaigns','RECORDS','Channel playbook + recent campaign samples','audit','quarterly','Marketing',true,true),
('chan-entity-paid','Entity paid media','Run PPC, display, retargeting, social ads for the entity (or document N/A).','Channels & Campaigns','RECORDS','Paid media report or N/A','audit','monthly','Marketing',true,true),
('chan-entity-content','Entity organic & content','Blog, video, podcasts, case studies cadence for the entity.','Channels & Campaigns','RECORDS','Content calendar / published inventory','audit','quarterly','Marketing',true,true),
('chan-entity-offline','Entity traditional / offline','Events, print, direct mail, partnerships when relevant (or N/A).','Channels & Campaigns','RECORDS','Offline plan or N/A','audit','annual','Marketing',true,true),
('chan-entity-crm-nurture','Entity CRM & lead nurturing','Lead capture, scoring, and follow-up processes per entity.','Channels & Campaigns','RECORDS','Lead flow SOP + CRM config notes','audit','quarterly','Marketing',true,true),
('chan-entity-local-campaigns','Entity local campaigns','Entity-specific campaigns with local targeting, language, and offers.','Channels & Campaigns','RECORDS','Campaign briefs + results','audit','quarterly','Marketing',true,true),
('chan-group-campaigns','Group-wide campaigns','Coordinate group campaigns (thought leadership, seasonal, cross-entity).','Channels & Campaigns','RECORDS','Group campaign briefs + calendar','audit','quarterly','Marketing',true,false),
('chan-group-shared-channels','Shared channel strategies','Group website sections, corporate social presence, joint events strategy.','Channels & Campaigns','RECORDS','Shared channel plan','audit','annual','Marketing',true,false),
('chan-group-media-buying','Centralized media buying / agencies','Centralized media buying or agency relationships for scale and rates.','Channels & Campaigns','RECORDS','Agency roster + rate cards / SOWs','audit','annual','Marketing',true,false),
('chan-cross-promo','Cross-promotion & referral programs','Cross-promotion and referral programs between subsidiaries.','Channels & Campaigns','RECORDS','Referral / cross-promo program docs','audit','quarterly','Marketing',true,false),
('chan-campaign-calendar','Campaign calendar (group + entity)','Maintain campaign calendar covering group and entity initiatives.','Channels & Campaigns','RECORDS','Living campaign calendar','audit','monthly','Marketing',true,true),
('chan-spend-tracking-suite','Campaign spend & ROI in Suite-linked tools','Track campaign spend/performance in tools that integrate with Intuit Enterprise Suite for ROI.','Channels & Campaigns','RECORDS','Export showing costs attributed to campaigns','audit','monthly','Marketing / Finance',true,true),
('budget-entity-annual','Entity annual & campaign budgets','Create annual and campaign-specific marketing budgets per subsidiary.','Budgeting & ROI','RECORDS','Entity marketing budget','audit','annual','Marketing / Finance',true,true),
('budget-entity-resources','Entity resource allocation','Allocate people/tools/agencies based on entity goals and revenue contribution.','Budgeting & ROI','RECORDS','Resource allocation plan','audit','annual','Marketing',true,true),
('budget-group-framework','Group marketing budget & allocation','Centralized group marketing budget with allocation framework to subsidiaries.','Budgeting & ROI','RECORDS','Group budget + allocation model','audit','annual','Marketing / Finance',true,false),
('budget-shared-services','Shared marketing services / pooled resources','Shared services or pooled creative/media/tech for cost efficiency.','Budgeting & ROI','RECORDS','Shared services roster + cost pool','audit','annual','Marketing',true,false),
('budget-attribution-model','Attribution model defined','Define clear attribution models (first-touch, multi-touch, etc.).','Budgeting & ROI','POLICY','Documented attribution model','audit','annual','Marketing',true,true),
('budget-cac-roas-roi','CAC / ROAS / Marketing ROI metrics','Calculate CAC, ROAS, Marketing ROI for the scope.','Budgeting & ROI','RECORDS','Latest CAC/ROAS/ROI report','audit','monthly','Marketing',true,true),
('budget-suite-expense-link','Intuit Suite marketing expense linkage','Record marketing expenses per campaign/entity in Intuit Enterprise Suite; correlate with CRM revenue.','Budgeting & ROI','RECORDS','Suite expense report + attribution note','audit','monthly','Marketing / Finance',true,true),
('budget-variance-reviews','Budget vs actual variance reviews','Regular budget vs actual reviews with variance analysis (entity and/or group).','Budgeting & ROI','RECORDS','Variance review pack','audit','monthly','Marketing / Finance',true,true),
('analytics-entity-kpis','Entity KPI dashboards','Track entity KPIs: traffic, conversion, engagement, leads, sales attributed to marketing.','Analytics & Reporting','RECORDS','Entity marketing dashboard','audit','monthly','Marketing',true,true),
('analytics-entity-reviews','Entity performance reviews & optimization','Regular performance reviews and optimization actions documented.','Analytics & Reporting','RECORDS','Review notes + action log','audit','monthly','Marketing',true,true),
('analytics-group-dashboards','Consolidated group dashboards','Group-wide performance dashboards with entity breakdowns.','Analytics & Reporting','RECORDS','Group dashboard export / link','audit','monthly','Marketing',true,false),
('analytics-group-metrics','Group brand / pipeline metrics','Track overall brand awareness, total leads, pipeline influence, retention, marketing contribution to revenue.','Analytics & Reporting','RECORDS','Group metrics pack','audit','monthly','Marketing',true,false),
('analytics-journey-attribution','Cross-entity journey & attribution','Customer journey mapping across entities; portfolio attribution; competitive benchmarking.','Analytics & Reporting','RECORDS','Journey / attribution analysis','audit','quarterly','Marketing',true,false),
('analytics-leadership-reports','Leadership marketing performance reports','Monthly/quarterly group marketing performance reports to leadership.','Analytics & Reporting','RECORDS','Leadership report deck','audit','quarterly','Marketing',true,false),
('analytics-tooling','Analytics tooling (GA4 / Meta / BI)','Combine platform analytics with BI; feed key metrics toward Suite-aligned dashboards.','Analytics & Reporting','RECORDS','Tool access map + sample reports','audit','annual','Marketing',true,true),
('tech-entity-tools','Entity MarTech tools','Tools suited to entity needs/scale (local CRM, email platforms) documented.','MarTech Stack','RECORDS','Entity tool inventory','audit','annual','Marketing',true,true),
('tech-group-stack','Shared / centralized MarTech stack','Centralized or shared MarTech for consistency and data sharing.','MarTech Stack','RECORDS','Group MarTech architecture diagram','audit','annual','Marketing',true,false),
('tech-automation-crm','Marketing automation / CRM','HubSpot, Salesforce, or similar — integrate with Intuit for expense and revenue sync.','MarTech Stack','RECORDS','CRM/automation config + Suite integration note','audit','annual','Marketing',true,true),
('tech-attribution-platform','Analytics & attribution platforms','Attribution platforms selected and connected where used.','MarTech Stack','RECORDS','Platform list + access','audit','annual','Marketing',true,true),
('tech-cms-dam','CMS and DAM systems','Content management and DAM systems operational.','MarTech Stack','RECORDS','CMS/DAM inventory','audit','annual','Marketing',true,false),
('tech-ad-social-scheduling','Ad management & social scheduling','Ad management and social scheduling tools with shared access where needed.','MarTech Stack','RECORDS','Tool roster + access','audit','annual','Marketing',true,true),
('tech-campaign-pm','Campaign project management','Shared project management for campaigns.','MarTech Stack','RECORDS','PM workspace + sample board','audit','annual','Marketing',true,true),
('tech-privacy-compliance','MarTech privacy compliance (GDPR/CCPA)','Ensure data privacy compliance and Suite integration for expense/ROI reporting.','MarTech Stack','POLICY','Privacy compliance checklist for MarTech','audit','annual','Marketing / Legal',true,true),
('team-entity-resources','Entity marketing resources','Dedicated or shared marketing resources per subsidiary (in-house, freelancers, local agencies).','Team & Governance','RECORDS','Entity staffing / agency roster','audit','annual','Marketing',true,true),
('team-entity-roles','Entity roles & local decision rights','Clear roles for execution and local decision-making.','Team & Governance','POLICY','RACI / decision rights','audit','annual','Marketing',true,true),
('team-group-leadership','Centralized marketing leadership','Group CMO / marketing director for strategy, brand governance, shared services.','Team & Governance','RECORDS','Leadership charter / org chart','audit','annual','Marketing',true,false),
('team-hybrid-model','Hybrid central + entity team model','Central team (strategy/brand/major campaigns/tools) + entity teams (localized execution).','Team & Governance','POLICY','Hybrid operating model doc','audit','annual','Marketing',true,false),
('team-marketing-council','Marketing council / steering committee','Governance council with subsidiary representatives for alignment.','Team & Governance','RECORDS','Council charter + meeting cadence','audit','quarterly','Marketing',true,false),
('team-knowledge-sharing','Training & knowledge sharing','Training and knowledge sharing across the group.','Team & Governance','RECORDS','Training calendar / share sessions','audit','quarterly','Marketing',true,true),
('comp-group-ad-policies','Group advertising & claims policies','Group policies for advertising standards, claims substantiation, and IP.','Compliance & Risk','POLICY','Adopted advertising / claims policies','audit','annual','Marketing / Legal',true,false),
('comp-group-privacy-policy','Group marketing data privacy policy','Group-level policies for marketing data privacy.','Compliance & Risk','POLICY','Marketing privacy policy','audit','annual','Marketing / Legal',true,false),
('comp-entity-local-regs','Entity local marketing regulations','Entity-level compliance with local regulations and industry rules.','Compliance & Risk','RECORDS','Local compliance checklist or counsel note','audit','annual','Marketing / Legal',true,true),
('comp-campaign-risk-assessment','Campaign risk assessment','Risk assessment for campaigns (reputational, legal).','Compliance & Risk','RECORDS','Risk assessments for recent high-reach campaigns','audit','quarterly','Marketing / Legal',true,true),
('comp-high-risk-review','Centralized high-risk campaign review','Centralized review process for high-risk or group-level campaigns.','Compliance & Risk','POLICY','Review workflow + log','audit','annual','Marketing / Legal',true,false),
('review-entity-ab-testing','Entity A/B testing & monthly/quarterly reviews','Monthly/quarterly performance reviews, A/B testing, and optimization.','Review & Audit','RECORDS','Review notes + test log','audit','monthly','Marketing',true,true),
('review-group-brand-audit','Group brand consistency audit','Periodic audits of brand consistency across entities.','Review & Audit','RECORDS','Brand consistency audit report','audit','annual','Marketing',true,false),
('review-group-effectiveness','Group campaign effectiveness & budget efficiency audit','Periodic audits of campaign effectiveness, budget efficiency, and ROI.','Review & Audit','RECORDS','Effectiveness / efficiency audit pack','audit','quarterly','Marketing',true,false),
('review-annual-plan-refresh','Annual marketing plan review & refresh','Annual comprehensive marketing plan review and refresh.','Review & Audit','RECORDS','Refreshed plan + approval','audit','annual','Marketing',true,true),
('review-suite-spend-eval','Suite spend + analytics effectiveness evaluation','Use Intuit Suite spend data combined with marketing analytics to evaluate effectiveness and reallocate.','Review & Audit','RECORDS','Reallocation recommendations memo','audit','quarterly','Marketing / Finance',true,true),
('rec-command-center-visibility','Multi-Entity Command Center marketing visibility','Use Multi-Entity Command Center for group-level visibility on marketing spend and performance.','Platform Integration','RECORDS','Command Center marketing view / export','recommended','quarterly','Marketing / Finance',true,false),
('rec-lead-import-attribution','Lead / sales attribution import to Suite','Import leads, sales attribution, or campaign performance metrics into Suite-linked workflows.','Platform Integration','RECORDS','Import/job config or sample sync','recommended','quarterly','Marketing / Finance',true,true),
('rec-content-ops-hub','Content ops hub used for blog/social','Use portal Content hub / Blog / Social for group and entity content operations where applicable.','Channels & Campaigns','RECORDS','Published content cadence evidence','recommended','monthly','Marketing',true,true),
('rec-dam-access-review','DAM access review','Periodic review of DAM access for all marketing stakeholders across entities.','Branding & Positioning','RECORDS','Access review log','recommended','annual','Marketing',true,false),
('rec-agency-soc','Agency data-handling / SOC review','Review agency data-handling / security attestations for shared agencies.','Compliance & Risk','RECORDS','Agency SOC/DPA pack or N/A','recommended','annual','Marketing / Legal',true,false)
on conflict (control_key) do update set
  title = excluded.title,
  description = excluded.description,
  area = excluded.area,
  document_kind = excluded.document_kind,
  evidence_expectation = excluded.evidence_expectation,
  source = excluded.source,
  cadence = excluded.cadence,
  owner_role = excluded.owner_role,
  applies_to_parent = excluded.applies_to_parent,
  applies_to_entities = excluded.applies_to_entities,
  updated_at = now();

select public.provision_marketing_controls_for_parent();

do $mkt$
declare
  r record;
begin
  for r in
    select id from public.ops_entities
    where status in ('active', 'forming', 'acquired')
  loop
    perform public.provision_marketing_controls_for_entity(r.id);
  end loop;
end $mkt$;

select public.create_marketing_tasks_for_incomplete(null);
