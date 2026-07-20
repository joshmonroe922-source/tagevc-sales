# Tage VC Operating System — Phase 28

**YouTube/TikTok analytics · approval SLA digests · CoC email · template role mapping · Graph groups/SKUs · renewal alerts · Stage 4e soft-rename visibility (no DROP).**

## What shipped

### Multichannel Marketing
| Area | Status |
|------|--------|
| YouTube engagement (Data API + optional Analytics) | Done |
| TikTok engagement (opt-in `TIKTOK_ANALYTICS=1`) | Done |
| Approval SLA escalation digest (in-app + optional Resend) | Done |
| Hub: Run SLA digest · foundation flags for YT/TT | Done |

### DocuSign
| Area | Status |
|------|--------|
| CoC email on envelope completed (Resend) | Done |
| Template role-mapping UI in hub | Done |
| Multi-role send action + roles on template list | Done |
| Manual Email CoC hub action | Done |

### IT automation
| Area | Status |
|------|--------|
| Graph Entra group assign (opt-in) | Done — `MS_GRAPH_ASSIGN_GROUPS` |
| Graph M365 SKU assign (opt-in) | Done — `MS_GRAPH_ASSIGN_SKUS` |
| License / hardware renewal scan + weekly cron | Done |
| Hub renewal banner + scan button | Done |

### Snapshot retirement
| Area | Status |
|------|--------|
| Soft-rename path on Stage 4e checklist | Done |
| Offline `phase28_stage4e_drop.sql` (notice only) | Done |
| App DROP of `os_store_snapshots` | **Not done** |

## SQL

Apply **`tagevc-os/supabase/phase28_analytics_coc_renewals.sql`**.

Do **not** run `phase28_stage4e_drop.sql` except as a controlled offline ops session (soft rename preferred; script refuses DROP by default).

## Env (optional)

```bash
# Marketing
YOUTUBE_ANALYTICS=0
YOUTUBE_CHANNEL_ID=
TIKTOK_ANALYTICS=0
MARKETING_SLA_DIGEST_TO=
RESEND_API_KEY=
DIGEST_FROM_EMAIL=

# DocuSign CoC
DOCUSIGN_COC_EMAIL_TO=

# IT / Graph
MS_GRAPH_ASSIGN_GROUPS=0
MS_GRAPH_ONBOARD_GROUP_IDS=
MS_GRAPH_ASSIGN_SKUS=0
MS_GRAPH_ONBOARD_SKU_IDS=

# Stage 4e
SNAPSHOT_DROP_APPROVED_AT=
SNAPSHOT_DROP_APPROVED_BY=
ALLOW_SNAPSHOT_DROP=0
```

## Crons (vercel.json)

| Path | Schedule |
|------|----------|
| `/api/marketing/approval-sla-digest` | Daily 14:00 UTC |
| `/api/it/license-renewal-scan` | Mondays 08:00 UTC |

## Out of scope

- Full push notification system  
- User admin UI  
- Dropping `os_store_snapshots`  
- Major new modules  

## Phase 29+ recommendations

1. **Marketing:** Paid media stubs; SLA assignee routing; TikTok OAuth connect UX  
2. **DocuSign:** Recipient preview from live template API; void/reason audit trail polish  
3. **IT:** Graph offboard group/SKU remove; warranty column on hardware  
4. **Stage 4e:** Execute soft rename in a controlled window after checklist green  
5. **Platform:** Push notifications · user admin UI  
