# Tage VC Operating System — Phase 24

**Marketing maturation · DocuSign object storage · HR ticket offboarding · Stage 4e planning (no DROP).**

## What shipped

### Multichannel Marketing
| Area | Status |
|------|--------|
| OAuth token refresh (LinkedIn, X, Meta) + hourly cron | Done — `/api/marketing/token-refresh` |
| Additional platforms: Facebook, Instagram, YouTube OAuth | Done when Meta/Google env set |
| Analytics events + hub summary | Done — `os_marketing_analytics_events` |
| Manual engagement capture | Done |
| Hub UI: analytics panel, schedule status, multi-platform Connect | Done |

### DocuSign
| Area | Status |
|------|--------|
| Signed PDFs → Supabase Storage `docusign-signed` | Done |
| Large files skip inline base64; `storage_path` / `size_bytes` / `storage_error` | Done |
| Hub download links + error visibility | Done |

### IT offboarding
| Area | Status |
|------|--------|
| Start from HR/IT ticket (`user:<uuid>` in description) | Done |
| `ticket_id` / `source` on runs | Done |
| Complete → activity + broadcast notification | Done |

### Snapshot retirement
| Area | Status |
|------|--------|
| Retention window item on Stage 4e checklist (≥90d) | Done |
| Stage 4e DROP | **Not done** (planning / safety only) |

## SQL

Apply **`tagevc-os/supabase/phase24_maturation.sql`**.

Creates analytics table, token refresh columns, DocuSign storage columns, offboarding ticket link, and the `docusign-signed` storage bucket (+ select policy).

If bucket insert fails (permissions), create bucket `docusign-signed` manually in Supabase Dashboard → Storage (private, 50MB, PDF/text).

## Env (optional)

See `.env.example`:

```bash
# Meta (Facebook / Instagram)
META_APP_ID=
META_APP_SECRET=

# YouTube via Google OAuth
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=

# Existing: LINKEDIN_*, X_*, MARKETING_TOKEN_SECRET, MARKETING_SCHEDULER_ENABLED
```

## Cron

| Path | Schedule |
|------|----------|
| `/api/marketing/schedule-worker` | */15 |
| `/api/marketing/token-refresh` | hourly |
| `/api/admin/soak-health` | every 6h |

## Out of scope

- Full push notification system  
- User admin UI  
- Dropping `os_store_snapshots`  
- Advanced DocuSign templates / void  

## Phase 25+ recommendations

1. **Marketing:** Live engagement pull from LinkedIn/Meta APIs; approval SLA tickets; TikTok/ads later  
2. **DocuSign:** Certificate of completion; void/reminder UI; backfill legacy inline rows to Storage  
3. **IT:** Status-change-driven offboarding (HR employee inactive); MDM/Intune hooks  
4. **Stage 4e:** Explicit DROP only after checklist green + written ops approval  
5. **Platform:** Push notifications · user admin UI  
