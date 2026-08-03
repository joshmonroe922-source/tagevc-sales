# Build plan status

| Phase | Status |
|---|---|
| 0 Foundation | Done |
| 1 Compliance | Done |
| 2 Templates + merge | Done |
| 3 Audiences | Done |
| 4 Owned send path | Done (controlled_graph day-1; Postal adapter ready) |
| 5 ECC UI + CRM + team | Done |
| 5b DocuSign hooks | Partial (port + envelope_actions + journey send_envelope node) |
| 5c Multichannel VM+email | Done (webhook + paired_sends idempotency) |
| 6 Journeys visual builder | Done (xyflow editor, validation, vertical starter packs, node runs schema) |
| 7 Intelligence | Done (STO, RFM bands, attribution lite, AI assist human-approve only) |

## Phase 6 surface

- Sequences list + starter packs: `/shared-services/marketing/email-campaign-center/sequences`
- Graph editor: `/shared-services/marketing/email-campaign-center/sequences/[id]`
- APIs: `GET/POST /api/campaign/v1/journeys`, `GET/PATCH …/journeys/:id`, `GET/POST …/journeys/starter-packs`

## Phase 7 surface

- Intelligence: `/shared-services/marketing/email-campaign-center/intelligence`
- APIs: `GET /api/campaign/v1/intelligence`, `POST …/sto`, `POST/PATCH …/ai-assist`
- SQL: `supabase/phase_email_campaign_journeys_intel.sql`

```bash
set -a && source .env.local && set +a
node scripts/apply-phase-email-campaign-journeys-intel.mjs
```
