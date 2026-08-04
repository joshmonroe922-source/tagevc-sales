# Partner platform spine (Phase 89)

**Code:** `src/lib/partners/*` · **SQL:** `supabase/phase89_partner_spine.sql`  
**Principle:** Every current + future OS entity inherits the spine. Secrets never committed — env placeholders only. Fail-closed `*_LIVE=0` until Josh enables.

**HRIS:** Shared Services → Human Resources is the full operational HRIS for Tage, inherited by all entities. Signent HR sells HR services on the **same** platform with client segmentation (`client_org_id` under `ENT-SIGNENT`) — see `docs/HRIS_SPINE.md`.

**Honest status:** Adapter dry-runs and entity provision return `status: dry_run | partial_scaffold` — never treat scaffold as live-ready (`ok: false` / HTTP 202 on provision until hooks execute live).


## Partners

| Key | Owner (SS) | Scope | Status |
|-----|------------|-------|--------|
| `dialpad` | IT | All entities | Scaffolded |
| `verified_first` | HR (+ Recruiting) | Tage HR · R619 · Signent | **Live spine** (phase80) — secrets pending; see `docs/VERIFIED_FIRST_SCREENING_SPINE.md` § Connect |
| `mybasepay` | HR / Finance | Contractor EOR — **R619 first** | Scaffolded |
| `apollo` | Marketing | All entities → unified DB | Scaffolded |
| `gusto` | Finance / HR | Internal payroll + commissions | Scaffolded |
| `docusign` | Legal | Org per entity | **Live** (existing) |
| `linkedin_recruiter` | Recruiting | R619 primary; all later | Scaffolded |
| `appcast` | Recruiting / Marketing | All careers; **R619 live path** | Live @ R619 |
| `google_business` | **Marketing** | All entities | Scaffolded |
| `google_analytics` | **Marketing** | All entities (GA4) | Scaffolded |
| `linkedin_company` | **Marketing** | All entities (Company Pages) | Scaffolded |

Marketing presence trio (Google Business · GA4 · LinkedIn Company) is managed under **Shared Services → Marketing → Presence**, not buried only in IT.

## Architecture

```
os_partner_catalog
        │
        ▼
os_partner_entity_bindings  ←── new entity create (provisionPartnerSpineForEntity)
        │
        ├── os_partner_vendor_contracts / payments   (Technology admin)
        ├── os_marketing_presence_properties         (Marketing SS)
        ├── os_partner_events                        (webhook / import bus)
        ├── os_partner_bi_signals                    (AI BI feed)
        └── os_gusto_commission_stubs                (invoice → payroll)
```

### Inheritance

`provisionPartnerSpineForEntity(entityId)`:

1. Upserts bindings for every catalog partner (MyBasePay enabled only for recruiting-capable entities by default plan; R619 seeded enabled).
2. Creates Marketing presence slots: `google_business`, `google_analytics`, `linkedin_company`.
3. **Also provisions Vendor Management (Phase 90)** via `provisionVendorMgmtForEntity` — module enablement, entity alias, default cost centers.
4. Records a provision event for BI/audit.

Wire this from subsidiary / entity create flows (and call manually for existing entities after SQL apply).

See `docs/VENDOR_MANAGEMENT.md` for the Shared Services Ops spend/license spine UI.

### JML hooks

Joiner / leaver checklists gain partner hook IDs from `joinerPartnerHooks` / `leaverPartnerHooks` (Dialpad, Gusto, Verified First, Marketing presence admin revoke where product allows). Hooks are **queued labels** until each vendor API is LIVE.

### Secrets pattern

- Env keys listed on each partner in `src/lib/partners/catalog.ts` and `.env.example`.
- Never store API keys in `os_partner_entity_bindings.config` — only external IDs + non-secret meta.
- OAuth tokens for Marketing presence follow existing `os_marketing_oauth_tokens` vault pattern when wired.

## DocuSign — connect the org account

Existing live stack: `src/lib/docusign/*`, `/shared-services/legal/docusign`, Connect webhook.

### Connect path (Josh)

1. DocuSign Admin → **Apps and Keys** → create / open Integration Key for Tage VC.
2. Add RSA keypair; paste private key into `DOCUSIGN_PRIVATE_KEY` (keep `\n` escaped or multiline secret in Vercel).
3. Set `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID` (API user GUID), `DOCUSIGN_ACCOUNT_ID`.
4. Choose hosts:
   - Demo: `DOCUSIGN_OAUTH_HOST=account-d.docusign.com`, `DOCUSIGN_BASE_PATH=https://demo.docusign.net`
   - Prod: `account.docusign.com` + your account base (e.g. `https://na4.docusign.net`)
5. Grant JWT consent for the integration key (one-time browser consent URL from DocuSign docs).
6. Connect webhook: point DocuSign Connect to `https://app.tagevc.com/api/docusign/connect` with `DOCUSIGN_WEBHOOK_SECRET` / `DOCUSIGN_CONNECT_HMAC_SECRET`.
7. **Per subsidiary:** create or link a DocuSign account/brand under the Tage org; store `external_account_id` on `os_partner_entity_bindings` for `docusign` + that `entity_id`. Same Integration Key can impersonate users per account when configured.

UI: Shared Services → Legal → DocuSign. Technology stack page shows connection status for all entities.

## Marketing presence (GBP · GA4 · LinkedIn Company)

| Kind | Connect |
|------|---------|
| `google_business` | Google Cloud OAuth (Business Profile API) → set `GOOGLE_BUSINESS_*`; bind location ID per entity |
| `google_analytics` | GA4 property per entity; service account or OAuth → `GA4_PROPERTY_ID` / JSON; entity binding stores property ID |
| `linkedin_company` | LinkedIn Marketing / Organization API → `LINKEDIN_COMPANY_*`; store organization URN per entity |

UI: `/shared-services/marketing/presence`  
Imports land in `os_partner_bi_signals` + `last_import_at` when LIVE.
UI **Import dry-run** on Presence runs fail-closed stubs now and stamps `last_import_at` / BI rows with `meta.dry_run`.

## Gusto + commissions

Flow (scaffold):

1. Invoice marked paid (IES / A&F).
2. `queueCommissionFromPaidInvoice` → `os_gusto_commission_stubs` (`pending_push`).
3. If `GUSTO_LIVE=1` + token/company UUID → push payroll (stub records `gusto_ref`).
4. Else dry-run only.

## Appcast / MyBasePay @ Recruit 619

- **Appcast:** Already live-path on `recruit619-portal` (`APPCAST_*`, feed + apply webhook). Spine binding `appcast` / `ENT-R619` mirrors status; firm entities get careers-slot scaffolding.
- **MyBasePay:** Portal scaffold under Recruit integrations (`mybasepay`); OS spine enables binding for `ENT-R619` only until other entities opt in.

## AI Business Intelligence

`/shared-services/bi` (and C-Suite context can import `buildPartnerBiReport`) surfaces:

- Partner connection posture
- Marketing presence slots
- Commission queue
- Imported partner signals

## Apply SQL

```bash
set -a && source .env.local && set +a
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/phase89_partner_spine.sql
```

## Decision defaults (2026-08-02)

- **D01:** Hold most `*_LIVE` until contracts land; **DocuSign now** — see `docs/DOCUSIGN_ENTITY_AUTOMATION.md`
- Full log: `docs/DECISION_LOG_2026-08-02.md`

## Josh actions (credentials)

1. Apply `phase89_partner_spine.sql` (+ phase91 Signent tenancy, phase92 AP/W-9)
2. DocuSign org JWT + Connect + per-entity `DOCUSIGN_ACCOUNT_ID_*`
3. Dialpad API key + webhook secret
4. Verified First: API key + webhook secret + package IDs now (CRM/SF not a blocker); set `VERIFIED_FIRST_LIVE=1` only after smoke — `docs/VERIFIED_FIRST_SCREENING_SPINE.md`
5. MyBasePay account for R619 contractor placements
6. Apollo API key
7. Gusto company + API token (commissions after payroll mapping)
8. LinkedIn Recruiter developer app (account coming)
9. Appcast employer credentials (confirm R619 env)
10. Google Business Profile API OAuth
11. GA4 properties per entity + service account
12. LinkedIn Company Page org URNs + OAuth
