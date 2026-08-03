# Deliverability

- Per-entity sending domains + DNS wizard
- Suppressions O(1) pre-send
- RFC 8058 one-click
- Kill switch on `ecc_entity_settings`
- **Day-1 bulk plane:** controlled Graph (Reply-To user + tracking)
- **Postal owned MTA** when env set — see below

## Postal / owned MTA (ready path — no invented DNS)

| Env | Purpose |
|-----|---------|
| `ECC_POSTAL_API_URL` or `POSTAL_API_URL` | Postal HTTP API base |
| `ECC_POSTAL_API_KEY` or `POSTAL_API_KEY` | Server API key |
| `POSTAL_WEBHOOK_SECRET` | DSN/FBL webhook auth |
| `CAMPAIGN_DNS_TRUST=0` | Require verified domains before bulk |

Adapter: `getOwnedMtaAdapter()` in `src/lib/campaign/mta/owned-mta.ts`.  
Orchestrator uses Postal only when plane=`owned_mta` **and** URL+key present; otherwise controlled Graph.

### Josh ops checklist (not eng invention)

1. Provision Postal (or equivalent OSS MTA) in target region
2. Allocate IP(s) + warm-up plan
3. Create `mail.<entity>` (or brand) zones: SPF, DKIM, DMARC
4. Paste real URL/key into Vercel/env — never commit secrets
5. Verify domains in ECC → Deliverability
6. Flip pilot campaign plane to `owned_mta`
7. Confirm DSN/FBL hooks hit `/api/campaign/hooks/mta/*`
