# Tage VC Operating System — Phase 27

**Approval SLA · LinkedIn Marketing impressions · DocuSign template send + reminder jobs · IT auto-onboard + Graph Intune · Stage 4e visibility (no DROP).**

## What shipped

### Multichannel Marketing
| Area | Status |
|------|--------|
| Approval workflow SLA (`approval_due_at`) + review ticket link | Done |
| Submit for review action + overdue badge in hub | Done |
| LinkedIn Marketing API impressions (opt-in) | Done — `LINKEDIN_MARKETING_API=1` + `LINKEDIN_ORG_URN` |
| Analytics depth (`impression_source`, foundation phase 27) | Done |

### DocuSign
| Area | Status |
|------|--------|
| Send envelope from template | Done — hub action |
| Scheduled reminder jobs (+1/+3/+7d) | Done — `os_docusign_reminder_jobs` |
| Reminder worker cron + hub queue | Done — `/api/docusign/reminder-worker` |
| Template cache management (from 26) | Retained |

### IT automation
| Area | Status |
|------|--------|
| Auto-onboard newly active profiles (14d lookback) | Done — skips users with any prior run |
| Onboarding status scan cron + hub button | Done |
| Microsoft Graph Intune (device inventory; optional retire) | Done — `MS_GRAPH_*` |
| MDM webhook retained | Done — runs alongside Graph when both set |

### Snapshot retirement
| Area | Status |
|------|--------|
| Stage 4e checklist + DROP approval env | Retained / Phase 27 copy |
| Offline `phase27_stage4e_drop.sql` (notice only) | Done — **does not DROP** |
| App DROP of `os_store_snapshots` | **Not done** |

## SQL

Apply **`tagevc-os/supabase/phase27_approval_sla_reminders.sql`**.

Do **not** run `phase27_stage4e_drop.sql` except as a controlled offline ops session after full checklist + approval (script refuses DROP by default).

## Env (optional)

```bash
# Marketing
MARKETING_APPROVAL_SLA_HOURS=48
LINKEDIN_MARKETING_API=0
LINKEDIN_ORG_URN=

# DocuSign reminders use DIGEST_SECRET / CRON_SECRET for worker auth

# IT / Intune
MDM_WEBHOOK_URL=
MDM_WEBHOOK_SECRET=
MS_GRAPH_TENANT_ID=
MS_GRAPH_CLIENT_ID=
MS_GRAPH_CLIENT_SECRET=
INTUNE_AUTO_RETIRE=0
IT_AUTO_ONBOARD=0

# Stage 4e (never auto-drops)
SNAPSHOT_DROP_APPROVED_AT=
SNAPSHOT_DROP_APPROVED_BY=
ALLOW_SNAPSHOT_DROP=0
```

## Crons (vercel.json)

| Path | Schedule |
|------|----------|
| `/api/docusign/reminder-worker` | Daily 09:00 UTC |
| `/api/it/onboarding-status-scan` | Daily 07:30 UTC |

## Out of scope

- Full push notification system  
- User admin UI  
- Dropping `os_store_snapshots`  
- Major new modules  

## Phase 28+ recommendations

1. **Marketing:** YouTube / TikTok analytics; paid media stubs; SLA escalation digests  
2. **DocuSign:** CoC email delivery; recipient-role mapping UI for templates; reminder channel prefs  
3. **IT:** Graph group membership / license SKU assign; renewal alerts into digests  
4. **Stage 4e:** Soft rename then offline DROP only after eligibility + written approval  
5. **Platform:** Push notifications · user admin UI  
