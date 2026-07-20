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

### Offboarding / onboarding (Phases 23–27)
1. Offboarding: manual, HR ticket, or inactive profile scan  
2. Onboarding: manual, HR ticket, or **active profile scan** (14d lookback; skips users with any prior run)  
3. MDM: Microsoft Graph Intune (`MS_GRAPH_*`) and/or `MDM_WEBHOOK_URL` with `action=offboard|onboard`  
4. Optional: `IT_AUTO_ONBOARD=1` to auto-execute onboarding on scan; `INTUNE_AUTO_RETIRE=1` to retire devices on offboard  
5. Complete marks remaining access notes · activity + notifications  

SQL: through `phase27_approval_sla_reminders.sql` (IT tables from phase26).

## Phase 28+

1. Graph group membership / license SKU assign  
2. Renewal alerts into Activity / digests  

## Out of scope

- Purchase-order accounting  
- Full CMDB  
