# Hardware, Software & Licensing — Architecture (Phase 21)

**Status:** Live CRUD + assign/revoke under Shared Services · IT.  
**Non-goal:** Full onboarding/offboarding automation (Phase 22+).

## Placement

| Layer | Location |
|-------|----------|
| Product hub | `/shared-services/it/assets` |
| Repo | `tagevc-os/src/lib/shared-services/it-assets-repo.ts` |
| Actions | `shared-services/it/assets/actions.ts` |
| Types | `it-assets-types.ts` |
| SQL | `phase20_it_assets.sql` + `phase21_shared_services.sql` |

## Domain model

```
os_it_hardware_assets
  asset_id · kind · status · entity_id · assigned_user_id · serial · model

os_it_software_licenses
  license_id · product · vendor · seats · entity_id · renewal_date · cost_k

os_it_assignment_events (append-only)
  assign | return | license_grant | license_revoke
```

## Permissions

| Permission | Roles (examples) |
|------------|------------------|
| `read:it_assets` | visionary, partner, coo, service_lead, sub_lead, counsel_ops, admin |
| `write:it_assets` | visionary, coo, service_lead, admin |

## Live workflows

### Assign hardware
1. Create in-stock asset → Assign (prompt for user UUID)  
2. Status → `assigned` · event `assign`

### Return hardware
1. Return → `in_stock` · clears assignee · event `return`

### Grant / revoke seat
1. Grant increments `seats_used` (respects `seat_count`)  
2. Revoke decrements · events `license_grant` / `license_revoke`

### Offboarding / onboarding (Phases 23–32)
1. Offboarding: inactive scan + Graph **remove** groups/SKUs + **disable account** (opt-in)  
2. Onboarding: active scan + Graph **assign** groups/SKUs (opt-in)  
3. Hardware **warranty_ends_at** drives renewal alerts (else 3y refresh)  
4. **Bulk warranty CSV** (header-aware file or pasted CSV; asset ID or serial)
5. Exchange automation can enable litigation hold before SKU removal.
6. Mailbox mode can disable sign-in, retain mailbox, or opt-in soft-delete user.
7. Intune device retirement attempts are persisted in lifecycle history.
8. Hold submission remains pending until Exchange returns provider-verified
   evidence; accepted HTTP status alone is insufficient.
9. Failed automation steps can be retried. Pending automation cannot be marked
   verified by the completion action.
10. Intune inventory follows Graph pagination and reports compliance,
    encryption, ownership, and last-sync context.
11. Warranty imports reject duplicate/conflicting rows and write before/after
    lifecycle evidence.

SQL: through `phase32_operational_evidence.sql`.

## Phase 33

1. Warranty CSV is previewed into an immutable batch. Commit locks and
   revalidates every target, updates all assets, writes per-asset lifecycle
   events, and marks the batch committed in one PostgreSQL transaction.
2. Duplicate/ambiguous serials, duplicate target assets, invalid dates, and
   stale previews reject the whole batch.
3. Intune retire creates one idempotent per-device action before Graph POST.
   HTTP acceptance is stored as `submitted`; only a later provider state/404
   verification becomes `verified`.
4. Structured request metadata, Graph request ID, HTTP evidence, polling
   evidence, attempts, and status transitions replace human-only audit text.

SQL: `phase33_it_warranty_intune_soak.sql`.

## Phase 34

1. Offboarding inventory creates requested per-device Intune intents and never
   submits a retirement inline.
2. Operators must type `RETIRE`, provide an approval reason, and approve a
   specific action before dispatch.
3. A five-minute worker claims actions with database leases, correlates Graph
   requests, separates HTTP acceptance from verification, and polls boundedly.
4. Structured verification codes distinguish retired state, post-submission
   absence, provider rejection, and poll timeout.
5. The IT hub shows request metadata, attempts, poll count, Graph request ID,
   provider state, errors, and verification evidence.

SQL: `phase34_intune_drill_governance.sql`.

## Phase 35+

1. Cancel/retry controls with fresh approval and explicit local-asset matching
2. Signed Exchange hold callback + deleted-user restore
3. Downloadable warranty preview failure reports

## Out of scope

- Purchase-order accounting  
- Full CMDB  
