# Vendor Management spine (Phase 90)

**Workbook SSOT:** `Vendor Management.xlsx` (Build Handoff + Data Dictionary)  
**Code:** `src/lib/vendor-mgmt/*` · **SQL:** `supabase/phase90_vendor_management_spine.sql`  
**UI:** `/shared-services/ops/vendor-management`  
**Alias:** `/shared-services/it/vendor-mgmt` → redirects to Operations path  
**Extends:** Phase 89 partner spine (`docs/PARTNER_SPINE.md`) — does not fork a second vendor DB.

## Placement

Shared Services → **Vendor Management** (SSC peer of Technology; Group Ops path).  
Co-owners: Group Ops (PO), Finance (money/renewals), IT (licenses/offboard).

Entity-scoped views of the **same** portal for:

| Code | OS `entity_id` | Company |
|------|----------------|---------|
| TAGE | `ENT-FIRM` | Tage Venture Capital |
| R619 | `ENT-R619` | Recruit 619 |
| SHR | `ENT-SIGNENT` | Signent HR |
| INDA | `ENT-INDA` | Instant NDA |

## Modules (M1–M12)

| # | Module | Status |
|---|--------|--------|
| M1 | AuthZ matrix × entity scope (maps OS roles → AR-*) | Live |
| M2 | Entity codes + cost centers | Live (CC CRUD light) |
| M3 | Vendors + profiles + monthly normalization | Live |
| M4 | Products + role birthright | Live |
| M5 | Employees | Live |
| M6 | Renewals / approvals | Live |
| M7 | Access requests + lifecycle cases | Live |
| M8 | Budgets vs actual + chargeback | Live |
| M9 | Usage / reclaim signals | Live (manual/API feed later) |
| M10 | Hire simulator + CPE/RPE read models | Live |
| M11 | Alert rules + audit log | Live |
| M12 | Integrations registry | Scaffold (no fake credentials) |

## Inheritance for future entities

`provisionPartnerSpineForEntity(entityId)` (Phase 89) now also calls  
`provisionVendorMgmtForEntity(entityId)` which:

1. Upserts `vm_entity_codes` (suggested short code)
2. Enables `vm_entity_module_enablement`
3. Seeds `vm_revenue_inputs`
4. Writes audit `vendor.module.provision`

API: `POST /api/partners/provision-entity` still the entrypoint.

## Business rules (acceptance)

- Annual $1200 → $100 `monthly_usd`; Per User seats×unit preferred
- Terminate → entitlements 0 + linked `vm_admin_users` Inactive + offboard case
- Vendor list filtered by entity scope unless firm-wide / AR-SUPER
- Chargeback Fixed % must sum to 100%
- Renewal stages OK / 90 / 60 / 30 / EXPIRED from contract_end − as_of
- Computed fields never accepted from the client

## Apply SQL

```bash
set -a && source .env.local && set +a
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/phase90_vendor_management_spine.sql
```

## Key routes

- `/shared-services/ops/vendor-management` — dashboard
- `.../vendors` · `.../vendors/new` · `.../vendors/[id]`
- `.../renewals` · `.../products` · `.../roles` · `.../employees`
- `.../access` · `.../lifecycle` · `.../budgets` · `.../chargeback`
- `.../usage` · `.../hire` · `.../alerts` · `.../audit`
- `.../integrations` · `.../settings` · `.../admins`

## Deferred / next

- Live HRIS / IdP / SaaS connector jobs (registry only)
- Step-up MFA challenge UI for contract $ (permission gate present)
- Bulk CSV import from Seed_Export headers
- A&F AP vendor link (1099 portal remains separate)

## Shipped follow-ons

- Cost centers + comp bands CRUD at `/shared-services/ops/vendor-management/cost-centers`
