# Tage VC Operating System — Phase 26

**X engagement · richer analytics · DocuSign reminders/templates · IT onboarding mirror · Stage 4e gates (no DROP).**

## What shipped

### Multichannel Marketing
| Area | Status |
|------|--------|
| Live X (Twitter) engagement pull | Done — public_metrics via API |
| Engagement rate + platform comparison | Done |
| Comments/shares totals in hub analytics | Done |

### DocuSign
| Area | Status |
|------|--------|
| Reminder on pending envelopes | Done — hub + events log |
| Template sync + hub visibility | Done — `os_docusign_templates` |
| CoC / void / Storage (from 25) | Retained |

### IT automation
| Area | Status |
|------|--------|
| Onboarding runs (assign HW + grant seats) | Done — `os_it_onboarding_runs` |
| HR ticket onboarding candidates | Done |
| MDM lifecycle hook (`onboard` / `offboard`) | Done — `it-mdm.ts` |

### Snapshot retirement
| Area | Status |
|------|--------|
| Checklist + SNAPSHOT_DROP_APPROVED_* gates | Retained / Phase 26 copy |
| App DROP of `os_store_snapshots` | **Not done** |

## SQL

Apply **`tagevc-os/supabase/phase26_onboarding_templates.sql`**.

Do **not** run Stage 4e DROP scripts without full checklist + approval.

## Env (optional)

```bash
MDM_WEBHOOK_URL=
MDM_WEBHOOK_SECRET=
SNAPSHOT_DROP_APPROVED_AT=
SNAPSHOT_DROP_APPROVED_BY=
ALLOW_SNAPSHOT_DROP=0
```

## Out of scope

- Full push notification system  
- User admin UI  
- Dropping `os_store_snapshots`  
- Advanced DocuSign template-based send automation  

## Phase 27+ recommendations

1. **Marketing:** TikTok / YouTube analytics; approval SLA tickets; LinkedIn Marketing API impressions  
2. **DocuSign:** Send from template; recipient reminder schedules; CoC email  
3. **IT:** Intune Graph API (beyond webhook); onboarding from newly-active profiles  
4. **Stage 4e:** Offline rename then DROP after eligibility  
5. **Platform:** Push notifications · user admin UI  
