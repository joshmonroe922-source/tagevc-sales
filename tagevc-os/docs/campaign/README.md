# Tage Email Campaign Center

Spine service: `marketing.email_campaign_center`  
UI: Shared Services → Marketing → **Email Campaign Center**  
Route: `/shared-services/marketing/email-campaign-center`

## Principles (non-negotiable)

1. **No vendor ESP** — Owned MTA (Postal) for marketing bulk when configured.
2. **Graph = 1:1 / sales** — never blast via mailbox reputation for marketing at scale.
3. **Day-1 bulk plane** — locked Josh model: controlled platform send + **Reply-To user** + pixel/click tracking (`controlled_graph` via `sendPlatformEmail` channel `bulk`).
4. **CRM-first** — `contacts` table; no parallel identity store.
5. **entity_id + RLS** — JWT/session entity only.
6. **Compliance by construction** — physical address footer + RFC 8058 List-Unsubscribe.
7. **DocuSign via spine** — Document Library SoT.

## Packages (mapped into `src/lib/campaign/*`)

| Sheet package | Path |
|---|---|
| campaign-core | `src/lib/campaign/core` |
| campaign-db | `src/lib/campaign/db` |
| campaign-api | `src/app/api/campaign` |
| campaign-workers | `src/lib/campaign/workers` |
| campaign-providers | `src/lib/campaign/providers` |
| campaign-mta | `src/lib/campaign/mta` |
| campaign-docusign | `src/lib/campaign/docusign` |
| campaign-ui | `src/components/campaign` + ECC pages |
| campaign-pref-center | `src/lib/campaign/pref-center` + `/api/campaign/p/*` |

## Apply SQL

```bash
set -a && source .env.local && set +a
node scripts/apply-phase-email-campaign-platform.mjs
node scripts/apply-phase-email-campaign-journeys-intel.mjs
```

Phase 6–7: journey graph editor + starter packs under **Sequences**; engagement STO/AI/attribution under **Intelligence**.

## Cron

`/api/campaign/worker/send` — drains `ecc_send_jobs`.

## OpenAPI stub

`GET /api/campaign/v1/openapi`
