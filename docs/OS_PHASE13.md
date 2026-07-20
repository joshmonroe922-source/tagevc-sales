# Tage VC Operating System — Phase 13

**File uploads, private channels, moderation, RE normalize, notification prefs/digests.**

## What shipped

### Chat
| Area | Status |
|------|--------|
| Supabase Storage uploads (`chat-attachments` bucket) | Done |
| `os_message_files` + image/PDF previews | Done |
| Private channels + member add/remove | Done |
| Soft-delete messages (sender / owner) | Done |
| Channel settings + mute conversation | Done |

### Normalization
| Area | Status |
|------|--------|
| `os_re_deals` + `os_re_tasks` dual-write/read | Done |
| Snapshot retirement plan | Done — `docs/OS_SNAPSHOT_RETIREMENT.md` |

### Notifications
| Area | Status |
|------|--------|
| `os_notification_prefs` + settings UI | Done — `/settings/notifications` |
| Mute channels (prefs array) | Done |
| Digest API `POST /api/notifications/digest` | Done |
| Optional Resend email when `RESEND_API_KEY` set | Done |

## Required ops step

1. Run **`tagevc-os/supabase/phase13_uploads_and_re.sql`** in Supabase SQL editor.  
2. Confirm Storage bucket **chat-attachments** exists (created by SQL).  
3. Optional env on Vercel: `RESEND_API_KEY`, `DIGEST_FROM_EMAIL`, `DIGEST_SECRET` / `CRON_SECRET`.  
4. Redeploy.

## Phase 14+ recommendations

1. Execute snapshot soak → read cutover for dual-written domains  
2. Portfolio / Entity Master live tables  
3. Richer moderation (pin, audit log, report)  
4. Real DocuSign + document storage buckets  
5. Push notifications (web push / mobile)  
6. Observability (Sentry)
