-- Seed portfolio companies for Manage Portfolio (Entity Ops).
-- Extends ops_entities with slug + website_url for stable identity and later
-- per-company checklist/template attachment (start/acquire operate playbooks).
-- Run after 0004_entity_ops.sql.

-- ---------------------------------------------------------------------------
-- Minimal schema: stable slug + public website
-- ---------------------------------------------------------------------------
alter table public.ops_entities
  add column if not exists slug text,
  add column if not exists website_url text not null default '';

create unique index if not exists ops_entities_slug_uidx
  on public.ops_entities (slug)
  where slug is not null;

comment on column public.ops_entities.slug is
  'Stable key for seeded / known portfolio companies; used for idempotent seeds and future template links.';
comment on column public.ops_entities.website_url is
  'Public company website when known.';

-- ---------------------------------------------------------------------------
-- Seed: Recruit 619, Signent HR, Instant NDA (operate = live portfolio)
-- ---------------------------------------------------------------------------
do $$
declare
  v_entity_id uuid;
  v_slug text;
  v_name text;
  v_url text;
  v_notes text;
  rec record;
begin
  for rec in
    select *
    from (
      values
        (
          'recruit-619',
          'Recruit 619',
          'https://619recruiting.com',
          'Portfolio company — recruiting.'
        ),
        (
          'signent-hr',
          'Signent HR',
          'https://signenthr.com',
          'Portfolio company — HR.'
        ),
        (
          'instant-nda',
          'Instant NDA',
          'https://instantnda.us',
          'Portfolio company — NDA product.'
        )
    ) as t(slug, name, website_url, notes)
  loop
    v_slug := rec.slug;
    v_name := rec.name;
    v_url := rec.website_url;
    v_notes := rec.notes;

    select id into v_entity_id
    from public.ops_entities
    where slug = v_slug
    limit 1;

    if v_entity_id is null then
      select id into v_entity_id
      from public.ops_entities
      where lower(name) = lower(v_name)
      limit 1;
    end if;

    if v_entity_id is null then
      insert into public.ops_entities (
        name,
        slug,
        entity_type,
        status,
        website_url,
        notes
      )
      values (
        v_name,
        v_slug,
        'operate',
        'active',
        v_url,
        v_notes
      )
      returning id into v_entity_id;
    else
      update public.ops_entities
      set
        name = v_name,
        slug = v_slug,
        entity_type = 'operate',
        status = case
          when status in ('closed', 'dormant') then status
          else 'active'
        end,
        website_url = case
          when coalesce(website_url, '') = '' then v_url
          else website_url
        end,
        notes = case
          when coalesce(notes, '') = '' then v_notes
          else notes
        end,
        updated_at = now()
      where id = v_entity_id;
    end if;

    -- Seed default document folders if missing (same set as createEntity).
    insert into public.ops_folders (entity_id, name, sort_order)
    select v_entity_id, df.name, df.sort_order
    from public.ops_default_folders df
    where not exists (
      select 1
      from public.ops_folders f
      where f.entity_id = v_entity_id
        and f.name = df.name
    );
  end loop;
end $$;
