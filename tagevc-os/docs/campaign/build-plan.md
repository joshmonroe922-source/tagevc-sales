# Build plan status

| Phase | Status |
|---|---|
| 0 Foundation | Done |
| 1 Compliance | Done |
| 2 Templates + merge | Done |
| 3 Audiences | Done |
| 4 Owned send path | Done (controlled_graph day-1; Postal adapter ready) |
| 5 ECC UI + CRM + team | Done |
| 5b DocuSign hooks | **Done** (queue → dispatch via library SoT; journey send_envelope) |
| 5c Multichannel VM+email | Done (webhook + paired_sends idempotency) |
| 6 Journeys visual builder | Done (xyflow editor, validation, vertical starter packs, node runs schema) |
| 7 Intelligence | Done (STO, RFM bands, attribution lite, AI assist human-approve only) |

## Phase 5b surface

- `ecc_envelope_actions` queue + `ecc_library_document_refs`
- Journey `send_envelope` advances on enroll; goal exit on completed signature
- APIs: `GET/POST /api/campaign/v1/docusign` (library list, queue, dispatch with `explicit_human_confirm`)
- SQL: `supabase/phase_ecc_docusign_library.sql`

```bash
set -a && source .env.local && set +a
node scripts/apply-phase-ecc-docusign-library.mjs
node scripts/seed-ecc-demo.mjs ENT-FIRM
```

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

## Owned MTA (Postal) ready path

Day-1 bulk = controlled Graph. When Josh provisions Postal + DNS:

```
ECC_POSTAL_API_URL=https://postal.your-host   # or POSTAL_API_URL
ECC_POSTAL_API_KEY=…                         # or POSTAL_API_KEY
POSTAL_WEBHOOK_SECRET=…
```

Then set campaign / journey `delivery_plane=owned_mta`. Do **not** invent DNS — use real mail.* domains after SPF/DKIM/DMARC verify in Deliverability cockpit.
