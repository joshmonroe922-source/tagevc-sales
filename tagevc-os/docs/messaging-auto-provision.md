# Messaging auto-provision (MS-P3b)

## What “provisioned” means

A user is **provisioned** for Tage Messages when:

1. **Spine** (source of truth): row in `os_messaging_entity_memberships` with
   `deprovisioned_at IS NULL` for their home `entity_id` (`is_home = true`).
2. **Portal mirror** (UI badge): matching row in the subsidiary table  
   - Recruit 619 → `r619_messaging_memberships` (`status = active`)  
   - Instant NDA → `inda_messaging_memberships` (`status = active`)  
   - Signent → `signent_messaging_memberships` (`client_id IS NULL`, `active = true`)

Subsidiary `/messages` pages read the mirror. Chat itself always opens on
`app.tagevc.com/messages`. Cross-entity policy stays
`dm_opt_in_rooms_deny` (DMs allowed, rooms denied).

## Auto path (no manual Admin click)

| Event | What runs |
|---|---|
| `profiles` INSERT / UPDATE of `entity_id` or `active` | Trigger `profiles_sync_messaging_ms_p3b` → `sync_messaging_membership_for_profile_ms_p3b` |
| New Active row in `os_entity_registry` | Trigger seeds `os_messaging_default_channels` |
| Subsidiary Admin joiner lifecycle | Still calls `provisionMessagingMembership` (spine RPC + mirror); redundant with trigger but safe |

SQL: `supabase/phase_ms_p3b_messaging_auto_provision.sql`

One-shot backfill (also runs at end of that migration):

```sql
select public.backfill_messaging_memberships_ms_p3b();
```

## Ops / smoke

1. Apply `phase_ms_p3b_messaging_auto_provision.sql` on shared UDL Supabase.
2. Confirm spine + mirror for a known user:
   ```sql
   select * from os_messaging_entity_memberships where deprovisioned_at is null;
   select status from r619_messaging_memberships;
   ```
3. Open `https://portal.recruit619.com/messages` → badge shows **active** (not “not provisioned”).
4. Click **Open Tage Messages** → `app.tagevc.com/messages` with entity badge.
5. Future joiner: set `profiles.entity_id` + `active=true` → membership appears without Lifecycle UI.

SF CRM sync does **not** touch messaging tables.
