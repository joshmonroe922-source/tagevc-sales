-- Soft-archive 3 TEST Message Center threads (2026-07-26).
-- Idempotent: only rows with archived_at IS NULL are updated.
-- List query already hides archived via .is('archived_at', null).

-- 1) Tage Venture Capital · Shared service … (ticket TK-619202607252)
-- 2) SS-INDA-20260723-GR6Q · Instant NDA related
-- 3) LD-004 · Ledgerly ("Test")

with targets as (
  select id
  from public.os_conversations
  where archived_at is null
    and (
      linked_ref_id in ('TK-619202607252', 'SS-INDA-20260723-GR6Q', 'LD-004')
      or title ilike '%SS-INDA-20260723-GR6Q%'
      or title ilike '%LD-004%'
      or title ilike '%Ledgerly%'
      or (
        title ilike '%Shared service%'
        and (
          last_message_preview is null
          or last_message_preview = ''
          or last_message_preview ilike '%no messages%'
        )
      )
      or last_message_preview ilike '%What exactly did you want me to post about%'
    )
)
update public.os_conversations c
set
  archived_at = coalesce(c.archived_at, timestamptz '2026-07-26T18:15:00Z'),
  updated_at = greatest(c.updated_at, timestamptz '2026-07-26T18:15:00Z')
from targets t
where c.id = t.id
  and c.archived_at is null;

with targets as (
  select id
  from public.os_conversations
  where
    linked_ref_id in ('TK-619202607252', 'SS-INDA-20260723-GR6Q', 'LD-004')
    or title ilike '%SS-INDA-20260723-GR6Q%'
    or title ilike '%LD-004%'
    or title ilike '%Ledgerly%'
    or (
      title ilike '%Shared service%'
      and archived_at is not null
    )
    or last_message_preview ilike '%What exactly did you want me to post about%'
)
update public.os_messages m
set deleted_at = coalesce(m.deleted_at, timestamptz '2026-07-26T18:15:00Z')
from targets t
where m.conversation_id = t.id
  and m.deleted_at is null;
