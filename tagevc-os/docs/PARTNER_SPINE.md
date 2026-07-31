# Partner platform spine (Phase 89)

**Contract:** `partner-spine-v1`  
**SQL:** `supabase/phase89_partner_spine.sql`  
**Code:** `src/lib/partners/*`  
**Do not touch Instant NDA product work** — Instant NDA inherits enablement rows as an entity only.

## Architecture

```
os_partner_catalog  (firm definitions)
        │
        ▼
os_partner_entity_enablements  (per entity on/off + status)
        │
        ├── Technology UI  → contracts / payments / expirations
        ├── Marketing Presence → GBP · GA4 · LinkedIn Company Pages
        ├── Event bus (os_partner_events) → AI BI
        └── Lifecycle joiner/leaver hooks (stubs where APIs allow)
```

New entities call:

```sql
select public.provision_partner_spine_for_entity('ENT-ACME', 'Acme Co');
```

or `provisionPartnerSpineForEntity()` in `src/lib/partners/repo.ts`.

## Partners

| Key | Owner | Scope | Status |
|-----|-------|-------|--------|
| `dialpad` | IT | All entities | Scaffold |
| `verified_first` | HR | All (Signent scaffold) | **Live spine** (see `VERIFIED_FIRST_SCREENING_SPINE.md`) |
| `mybasepay` | HR | Architect all; **implement R619** | Scaffold @ R619 |
| `apollo` | Shared | All + unified DB | Scaffold |
| `gusto` | Finance | All internal payroll + commissions | Scaffold + commission queue |
| `docusign` | Legal | Org + subsidiaries | **Existing JWT/Connect** |
| `linkedin_recruiter` | Recruiting | All; primary R619 | Scaffold (account soon) |
| `appcast` | Recruiting | All careers; **immediate R619** | **Live on R619 portal** |
| `google_business` | **Marketing** | All entities | Scaffold |
| `google_analytics` | **Marketing** | All entities (GA4) | Scaffold |
| `linkedin_company_pages` | **Marketing** | All entities | Scaffold |

### Google Business / Analytics / LinkedIn Company Pages

Managed under **Marketing Shared Services** (`/shared-services/marketing/presence`), not buried only in IT.

- One row per `(entity_id, kind)` in `os_marketing_presence_properties`
- Distinct from LinkedIn **personal/publish** OAuth (`os_marketing_social_accounts`) and LinkedIn **Recruiter**
- Import stubs feed `os_partner_events` → BI when LIVE adapters land
- Joiner/leaver hooks ensure slots exist / revoke editor access (stub)

## DocuSign — connect the org account

Existing code: `src/lib/docusign/*`, Legal module `/shared-services/legal/docusign`.

1. DocuSign Admin → Apps and Keys → create **JWT Grant** integration key (or use Tage org app).
2. Grant consent for the impersonated user (User ID GUID).
3. Generate RSA keypair; paste private key into `DOCUSIGN_PRIVATE_KEY` (use `\n` for newlines in env).
4. Set on Vercel / `.env.local` (Tage OS):

```
DOCUSIGN_INTEGRATION_KEY=
DOCUSIGN_USER_ID=
DOCUSIGN_ACCOUNT_ID=
DOCUSIGN_PRIVATE_KEY=
DOCUSIGN_OAUTH_HOST=account.docusign.com   # or account-d for demo
DOCUSIGN_BASE_PATH=https://na4.docusign.net
DOCUSIGN_WEBHOOK_SECRET=
DOCUSIGN_CONNECT_HMAC_SECRET=
```

5. DocuSign Connect → HTTPS listener `https://app.tagevc.com/api/docusign/connect` (or current Connect route) with HMAC.
6. Per subsidiary: enable row in `os_partner_entity_enablements` (`docusign`); optional separate Account IDs later via `external_account_ref` / `config_meta` — today one org JWT serves firm templates.

When env incomplete, OS stays in **mock** envelope mode (`getDocuSignMode()`).

## MyBasePay @ Recruit 619

- Spine enablement defaults **on** only for `ENT-R619`
- Portal scaffold: `recruit619-portal` MyBasePay module + integration status
- Flows (placement → EOR worker) come later; adapters fail-closed unless `MYBASEPAY_LIVE=1`

## Appcast @ Recruit 619

- Feed + apply webhook already on portal (`APPCAST_LIVE`, dual-approve)
- Spine tracks firm-wide enablement + BI events; careers pages for other entities inherit the same partner key

## Gusto commissions

`invoice paid → calculateCommissionCents(rateBps) → os_partner_commission_queue → gustoQueueCommission()`  
LIVE push not implemented until Josh connects Gusto API.

## AI BI

`/shared-services/bi` aggregates partner connection gaps, contract expirations, presence slots, and points at `os_partner_events`.

## Apply SQL

```bash
set -a && source .env.local && set +a
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/phase89_partner_spine.sql
```

## Josh actions (credentials — do not invent)

1. Apply phase89 SQL on UDL
2. DocuSign org JWT + Connect HMAC (if not already production)
3. Dialpad API key + webhook secret
4. Verified First package account IDs (spine already fail-closed)
5. MyBasePay account → `MYBASEPAY_*` on R619 + OS
6. Apollo API key
7. Gusto company + API token
8. LinkedIn Recruiter app (when account issued)
9. Appcast already partially wired on R619 — confirm employer ID / LIVE
10. Google Business + GA4 OAuth clients; map property IDs per entity
11. LinkedIn Company Page OAuth (Marketing Organization API) per entity
