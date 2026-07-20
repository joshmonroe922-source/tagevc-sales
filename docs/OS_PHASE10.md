# Tage VC Operating System — Phase 10

**Basic Internal Messaging Foundation** for `tagevc-os/` (live at [app.tagevc.com](https://app.tagevc.com)).

## Goal

Ship usable **1:1 DMs** and **small group chats** with real-time delivery and unread indicators, while shaping the data model for later entity linking, threading, channels, and subsidiary-scoped messaging.

## What shipped

| Area | Status |
|------|--------|
| `os_conversations` / `os_conversation_members` / `os_messages` | Done — apply `supabase/phase10_messaging.sql` |
| Direct messages (unique `dm_key`) | Done |
| Small group chats (≤12 people) | Done |
| Real-time message delivery (Supabase Realtime) | Done |
| Message history per conversation | Done |
| Global **Messages** sidebar entry + unread badge | Done |
| Per-conversation unread counts | Done |
| Presence (online/offline via Realtime Presence) | Done (ephemeral) |
| Directory of active profiles for recipient picker | Done (`profiles_select_active_directory`) |
| Architecture stubs for entity linking + subsidiary scope | Done (columns reserved) |

## Required ops step

1. In Supabase SQL editor for project `opdqybaatfbwkokbzwli`, run **`tagevc-os/supabase/phase10_messaging.sql`**.
2. Confirm Realtime is enabled for the project (SQL adds tables to `supabase_realtime` publication).
3. Redeploy / refresh `app.tagevc.com`, open **Messages**, start a DM with another active user.

## Data model (architecture)

```
os_conversations
  kind: dm | group | channel(reserved)
  dm_key: unique sorted "uuidA:uuidB" for 1:1
  entity_id: NULL today → subsidiary scope later
  linked_ref_type / linked_ref_id: NULL today → lead|deal|entity|task later
  last_message_at / last_message_preview: list UX

os_conversation_members
  last_read_at → unread math
  member_role: owner | member
  left_at → soft leave without deleting history

os_messages
  body (plain text, ≤8k)
  parent_id → threading reserved (unused in UI)
  metadata jsonb → mentions / deep links later
```

**Create paths** use security-definer RPCs (`create_or_get_dm`, `create_group_chat`, `mark_conversation_read`) so membership inserts stay consistent under RLS.

**Unread** = count of messages from others with `created_at > last_read_at` for the current member.

**Presence** is not stored in Postgres; clients join channel `os-presence` and track `{ user_id }`. This is good enough for online/offline dots and avoids a polling table.

## App surface

- Route: `/messages` (optional `?c=<conversationId>`)
- Nav: `Messages` under Command Center (`src/lib/nav.ts`)
- Permissions: `read:messages` / `write:messages` on all roles
- UI: `MessagesShell` — list + thread + new-chat sheet

## Future layers (Phase 11+)

See summary in README Phase 10 / Phase 11 backlog. High level:

1. Entity / lead / deal / task linked conversations
2. Subsidiary-scoped rooms (`entity_id`)
3. Channels + @mentions
4. Attachments / rich text
5. Threading UI on `parent_id`
6. Push / email digests for unread
7. Message search + retention policies
