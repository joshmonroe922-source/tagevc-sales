# Tage VC Operating System — Phase 25

**Live marketing engagement · DocuSign CoC/void/backfill · Status-change offboarding · Stage 4e approval gates (no DROP).**

## What shipped

### Multichannel Marketing
| Area | Status |
|------|--------|
| Live LinkedIn + Meta engagement pull | Done — `/api/marketing/engagement-pull` (daily cron + hub button) |
| Analytics: 7-day trend, engagement by platform, API vs manual | Done |
| `external_post_id` on content (denormalized) | Done (SQL) |

### DocuSign
| Area | Status |
|------|--------|
| Certificate of Completion archive (`file_kind=certificate`) | Done |
| Void envelope from hub + Connect void notifications | Done |
| Backfill legacy `content_base64` → Storage | Done |

### IT offboarding
| Area | Status |
|------|--------|
| Inactive profile scan (`source=status_change`) | Done — daily cron + hub button |
| MDM webhook hook (`MDM_WEBHOOK_URL`) | Done (optional) |
| Split MDM vs SSO checklist items | Done |

### Snapshot retirement
| Area | Status |
|------|--------|
| `SNAPSHOT_DROP_APPROVED_AT/BY` + eligibility `ready` | Done |
| Manual offline DROP SQL | Done — `phase25_stage4e_drop.sql` (commented) |
| App DROP of `os_store_snapshots` | **Not done** |

## SQL

Apply **`tagevc-os/supabase/phase25_engagement_docusign.sql`**.

Do **not** apply `phase25_stage4e_drop.sql` unless ops explicitly runs Stage 4e offline.

## Env (optional)

```bash
SNAPSHOT_DROP_APPROVED_AT=
SNAPSHOT_DROP_APPROVED_BY=
ALLOW_SNAPSHOT_DROP=0
MDM_WEBHOOK_URL=
MDM_WEBHOOK_SECRET=
```

## Cron

| Path | Schedule |
|------|----------|
| `/api/marketing/engagement-pull` | daily 06:00 UTC |
| `/api/it/offboarding-status-scan` | daily 07:00 UTC |
| (existing) schedule-worker, token-refresh, soak-health | unchanged |

## Out of scope

- Full push notification system  
- User admin UI  
- Dropping `os_store_snapshots` from the running app  

## Phase 26+ recommendations

1. **Marketing:** X engagement pull; Marketing API impressions (LinkedIn); approval SLA tickets  
2. **DocuSign:** Reminders; template catalog; CoC email to counterparties  
3. **IT:** Full MDM/Intune integration; onboarding mirror of offboarding  
4. **Stage 4e:** Offline rename then DROP after eligibility + written approval  
5. **Platform:** Push notifications · user admin UI  
