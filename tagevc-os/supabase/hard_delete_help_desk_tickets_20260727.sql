-- Hard-delete Help Desk (requester/portal) setup/test tickets.
-- Keeps SSC checklist / HRIS / AI-document tickets (To Do List).
-- Prefer scripts/hard-delete-help-desk-tickets.mjs with service role.

-- Related audits
delete from public.os_ticket_audits
where ticket_id in (
  'TK-619202607263',
  'TK-619202607262',
  'TK-619202607252',
  'SS-INDA-20260724-Y7TX',
  'SS-INDA-20260723-GR6Q',
  'SS-R619-20260723-XNY3',
  'TK-001',
  'TK-002',
  'TK-003',
  'TK-004',
  'TK-005'
);

delete from public.os_ticket_context_links
where ticket_id in (
  'TK-619202607263',
  'TK-619202607262',
  'TK-619202607252',
  'SS-INDA-20260724-Y7TX',
  'SS-INDA-20260723-GR6Q',
  'SS-R619-20260723-XNY3',
  'TK-001',
  'TK-002',
  'TK-003',
  'TK-004',
  'TK-005'
);

-- Message Center threads tied only to those tickets (already soft-archived)
update public.os_messages
set deleted_at = coalesce(deleted_at, now())
where conversation_id in (
  'ba2d0158-14ee-4d7c-81a0-efaa47932f64',
  'e10c70dc-affe-4e27-82bd-9c8381b8d6a1'
)
and deleted_at is null;

update public.os_conversations
set archived_at = coalesce(archived_at, now()),
    updated_at = greatest(updated_at, now())
where id in (
  'ba2d0158-14ee-4d7c-81a0-efaa47932f64',
  'e10c70dc-affe-4e27-82bd-9c8381b8d6a1'
)
and archived_at is null;

-- Subsidiary portal mirrors (help-desk intake only; keep INDA onboarding AH57)
delete from public.inda_ss_tickets
where ticket_id in ('SS-INDA-20260723-GR6Q', 'SS-INDA-20260724-Y7TX');

delete from public.r619_ss_tickets
where ticket_id in ('SS-R619-20260723-XNY3', 'SS-R619-20260723-6AWW');

-- Canonical Help Desk tickets
delete from public.os_tickets
where ticket_id in (
  'TK-619202607263',
  'TK-619202607262',
  'TK-619202607252',
  'SS-INDA-20260724-Y7TX',
  'SS-INDA-20260723-GR6Q',
  'SS-R619-20260723-XNY3',
  'TK-001',
  'TK-002',
  'TK-003',
  'TK-004',
  'TK-005'
);
