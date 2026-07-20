# Tage VC Operating System — Phase 12

**Channels, mentions, attachments, reactions + IC/MA normalization** for `tagevc-os/`.

## What shipped

### Chat
| Area | Status |
|------|--------|
| Channels (create firm/entity-scoped) | Done |
| @mentions + mention notifications | Done |
| Attach existing Documents to messages | Done |
| Message reactions (👍 👀 ✅) | Done |
| Global message search | Done |
| Mobile list/thread panes | Done |
| Notification digest grouping (Mentions / Chat / Firm) | Done |

### Normalization
| Area | Status |
|------|--------|
| `os_ic_reviews` dual-write/read | Done |
| `os_ma_targets` + `os_ma_tasks` dual-write/read | Done |
| Snapshots remain fallback | Done |

## Required ops step

Run **`tagevc-os/supabase/phase12_channels_and_normalize.sql`** in Supabase SQL editor after Phase 11.

## Architecture notes

- Channels use `kind = 'channel'`; `create_channel` invites selected members or all active profiles when empty.
- Mentions live in `metadata.mentions` + `notify_message_mentions` RPC (`kind = chat_mention`).
- Document attachments live in `metadata.attachments: [{ doc_id, title }]` (no binary upload in Phase 12).
- Reactions are first-class: `os_message_reactions`.
- Digests are UI grouping for now (email/push deferred to Phase 13).

## Phase 13+ recommendations

1. Email/push digests + notification preferences
2. Normalize RE track; begin snapshot retirement soak
3. File upload storage (not just library attach)
4. Channel moderation / private channels
5. Richer reaction picker + message edit/delete UX
6. Real DocuSign + storage
