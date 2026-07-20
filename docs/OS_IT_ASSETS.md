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

### Offboarding (Phases 23–25)
1. Manual: start run by user UUID → checklist from assigned hardware + licenses  
2. From ticket: open HR/IT ticket with title/description containing `offboard` / `termination` / etc. and `user:<uuid>`  
3. Status change: daily scan of `profiles.active=false` starts runs (`source=status_change`)  
4. Execute auto-return/revoke · MDM webhook when `MDM_WEBHOOK_URL` set · Complete marks remaining access notes  
5. Activity + broadcast notifications  

SQL: `phase23_automation.sql` + `phase24_maturation.sql` (+ Phase 25 app routes).

## Phase 26+

1. Full MDM / Intune product integration  
2. Onboarding mirror (provision laptop / grant seats)  
3. Renewal alerts into Activity / digests  
4. Entity-scoped UI filters  

## Out of scope

- Purchase-order accounting  
- Full CMDB  
