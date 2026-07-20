# Hardware, Software & Licensing — Architecture (Phase 20)

**Status:** Designed · stub UI under Shared Services · IT.  
**Non-goal:** Full inventory CRUD in Phase 20.

## Placement

| Layer | Location |
|-------|----------|
| Product hub | Shared Services → IT → Assets |
| Stub route | `/shared-services/it/assets` |
| Types | `tagevc-os/src/lib/shared-services/it-assets-types.ts` |
| SQL stub | `tagevc-os/supabase/phase20_it_assets.sql` |

## Goals

1. Track firm/subsidiary **hardware** (laptops, phones, peripherals)  
2. Track **software licenses** (SaaS seats, renewals, cost_$k)  
3. Append-only **assignment events** for audit  
4. Entity-scoped access for subsidiary IT leads  
5. Hooks for **onboarding / offboarding** (Phase 22+ automation via tickets)

## Domain model

```
os_it_hardware_assets
  asset_id · kind · status · entity_id · assigned_user_id · serial · model

os_it_software_licenses
  license_id · product · vendor · seats · entity_id · renewal_date · cost_k

os_it_assignment_events (append-only)
  assign | return | license_grant | license_revoke
```

## Entity scope

- Every row may carry `entity_id` (null = firm pool)  
- RLS: firm-wide roles see all; subsidiary sees `can_access_entity`  
- App-layer filters should mirror Phase 18/19 pipeline soft/hide policy  

## Workflows (target)

### Assign hardware
1. Pick in-stock asset → assign to profile  
2. Write assignment event  
3. Optional: open SS ticket if MDM enrollment needed  

### Grant license seat
1. Check `seats_used < seat_count`  
2. Increment seats_used · event `license_grant`  
3. Renewal watch → Command Center / Activity later  

### Offboarding
1. List assets + licenses for user  
2. Return hardware · revoke seats  
3. Emit events · optional SS checklist ticket  

## Permissions (planned)

| Permission | Purpose |
|------------|---------|
| `read:it_assets` | View inventory (entity-scoped) |
| `write:it_assets` | Assign / update / license seats |
| `admin:it_assets` | Retire assets · firm pool |

Wire into `roles.ts` in Phase 21 when UI goes live.

## Relationship to Shared Services tickets

- IT service tag already exists on tickets  
- Future: ticket actions “Provision laptop” / “Revoke SaaS” spawn or close against these tables  
- Do not conflate with RE Deal Flow `asset_name` (real estate)

## Implementation slices (Phase 21+)

1. Apply SQL · list/detail UI for hardware + licenses  
2. Assign / return flows + events  
3. Seat grant/revoke with validation  
4. Offboarding checklist from Entity / HR  
5. Renewal alerts into Activity / digests  

## Out of scope here

- MDM / Intune integration  
- Purchase-order accounting  
- Full CMDB  
