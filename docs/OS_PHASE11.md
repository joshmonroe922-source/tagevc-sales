# Tage VC Operating System — Phase 11

**Contextual chat + Deals/Documents normalization** for `tagevc-os/` ([app.tagevc.com](https://app.tagevc.com)).

## Goal

Make messaging contextual and useful (threads, links, search, entry points, notifications) while advancing schema normalization for Deals and Documents under dual-write/dual-read.

## What shipped

### Chat enhancements
| Area | Status |
|------|--------|
| Message replies / threading (`parent_id`) | Done |
| Lightweight formatting (`**bold**`, URLs, newlines) | Done |
| Link conversation → lead / deal / entity / task / ticket / document | Done |
| Contextual **Chat** buttons on Lead, Deal, Entity, Ticket pages | Done |
| In-conversation search | Done |
| Chat → `app_notifications` for other members | Done (SQL trigger) |
| Activity inbox read/unread + mark all read | Done |
| Activity + Messages sidebar unread badges | Done |

### Schema normalization
| Area | Status |
|------|--------|
| `os_deals` + `os_deal_tasks` dual-write/read | Done |
| `os_documents` dual-write/read | Done |
| Snapshots remain fallback | Done |

## Required ops step

Run **`tagevc-os/supabase/phase11_chat_and_normalize.sql`** in the Supabase SQL editor (after Phase 10).

This adds:
- Notify trigger on `os_messages`
- RPCs: `link_conversation`, `find_or_create_linked_chat`, `search_conversation_messages`
- Tables: `os_deals`, `os_deal_tasks`, `os_documents`
- Realtime on `app_notifications`

## Architecture notes

- Linked chats are **group** conversations with `linked_ref_type` / `linked_ref_id` / optional `entity_id` (subsidiary scope later).
- `find_or_create_linked_chat` is idempotent per user+ref — reopen returns the same room.
- Chat notifications are per-member (`user_id` set), distinct from firm-wide broadcast (`user_id` null).
- Deals/docs follow Phase 9 leads/tickets pattern: hydrate prefers SQL when rows exist; otherwise migrate snapshot once; every mutation queues normalized sync.

## Phase 12+ recommendations

1. Invite members into linked chats; role-aware membership
2. Task-level chat entry + deep links from LT-/DT- IDs
3. Channels + @mentions
4. Normalize IC reviews, MA/RE tracks; begin snapshot soak/drop plan
5. Attachments / richer formatting
6. Push/email digests for unread chat
7. Real DocuSign + storage
